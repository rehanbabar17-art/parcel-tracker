import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  getConfig,
  saveConfig,
  getState,
  saveState,
  trackAllParcels,
  sendNtfy,
  buildSummary,
  notifyParcel,
  removeDeliveredParcels,
  syncFromB2,
  syncToB2
} from './src/server/engine.ts';
import { isB2Configured, putB2Config, putB2State } from './src/server/b2-sync.ts';
import { trackParcel } from './src/server/trackers/index.ts';
import type { CourierName, ParcelConfig } from './src/server/trackers/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT) || 3000;

async function startServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Initial B2 Synchronization
  if (isB2Configured()) {
    console.log('[Server] Connecting to Backblaze B2 on startup...');
    await syncFromB2().catch((err) => {
      console.warn('[Server] Startup B2 sync notice:', err?.message || err);
    });
  }

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), b2: isB2Configured() });
  });

  app.get('/api/b2/status', (req, res) => {
    res.json({
      configured: isB2Configured(),
      bucket: process.env.B2_BUCKET || null,
      endpoint: process.env.B2_ENDPOINT || null,
      prefix: 'parcel-tracker/'
    });
  });

  app.post('/api/b2/sync', async (req, res) => {
    if (!isB2Configured()) {
      return res.status(400).json({ error: 'Backblaze B2 is not configured.' });
    }
    try {
      const ok = await syncFromB2();
      res.json({ success: ok, trackerCount: getConfig().trackers.length });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'B2 sync failed' });
    }
  });

  app.get('/api/config', (req, res) => {
    res.json(getConfig());
  });

  app.post('/api/config', async (req, res) => {
    const updated = req.body;
    if (!updated || !Array.isArray(updated.trackers) || !updated.ntfy) {
      return res.status(400).json({ error: 'Invalid config payload' });
    }
    const saved = saveConfig(updated);
    if (isB2Configured()) {
      await putB2Config(saved).catch((err) => console.error('[B2] putB2Config failed:', err));
    }
    res.json(saved);
  });

  app.get('/api/parcels', async (req, res) => {
    // If requested or if B2 is configured, keep in sync with B2
    if (req.query.sync === 'true' && isB2Configured()) {
      await syncFromB2().catch(() => {});
    }

    const config = getConfig();
    const state = getState();

    // Run 48h check on read as well
    removeDeliveredParcels(config, state);

    const parcelsWithState = config.trackers
      .filter((p) => !state[`${p.courier}:${p.tracking_number}`]?.removed)
      .map((p) => {
        const key = `${p.courier}:${p.tracking_number}`;
        const entry = state[key] || {};
        return {
          ...p,
          state: entry
        };
      });

    res.json({
      parcels: parcelsWithState,
      summary: buildSummary(config, state),
      b2: {
        configured: isB2Configured(),
        bucket: process.env.B2_BUCKET || null
      },
      lastUpdated: new Date().toISOString()
    });
  });

  app.post('/api/parcels', async (req, res) => {
    const { name, courier, tracking_number } = req.body;
    if (!name || !courier || !tracking_number) {
      return res.status(400).json({ error: 'name, courier, and tracking_number are required' });
    }

    const config = getConfig();
    const exists = config.trackers.find(
      (p) => p.courier.toLowerCase() === courier.toLowerCase() && p.tracking_number.toLowerCase() === tracking_number.trim().toLowerCase()
    );

    if (exists) {
      return res.status(409).json({ error: 'Parcel already in tracking list' });
    }

    const newParcel: ParcelConfig = {
      name: name.trim(),
      courier: courier.toLowerCase() as CourierName,
      tracking_number: tracking_number.trim()
    };

    config.trackers.push(newParcel);
    saveConfig(config);

    // Ensure synced to B2 immediately
    if (isB2Configured()) {
      try {
        await putB2Config(config);
        console.log(`[B2] Added parcel ${newParcel.name} (${newParcel.courier}:${newParcel.tracking_number}) directly to B2 config.`);
      } catch (b2Err) {
        console.error('[B2] Failed to upload new parcel to B2:', b2Err);
      }
    }

    // Initial track & notify in background
    (async () => {
      try {
        const result = await trackParcel(newParcel.courier, newParcel.tracking_number);
        const state = getState();
        const key = `${newParcel.courier}:${newParcel.tracking_number}`;
        const lastEvent = result.history?.[0]?.timestamp || '';
        state[key] = {
          ...state[key],
          status: result.status,
          last_checked: new Date().toISOString(),
          location: result.location,
          last_event_time: lastEvent,
          history: result.history,
          customer: result.customer,
          delivered_at: result.delivered ? (state[key]?.delivered_at || new Date().toISOString()) : state[key]?.delivered_at
        };
        saveState(state);
        const notifyRes = await notifyParcel(newParcel.name, newParcel.courier, newParcel.tracking_number, result.status, result.location, result.history);
        if (notifyRes.success) {
          state[key].last_notified_event_time = lastEvent;
          saveState(state);
        }
        if (isB2Configured()) {
          await putB2State(state).catch(() => {});
        }
      } catch (e) {
        console.warn('Initial tracking/notification error:', e);
      }
    })();

    res.json({ success: true, parcel: newParcel, b2Synced: isB2Configured() });
  });

  app.post('/api/parcels/:courier/:trackingNumber/notify', async (req, res) => {
    const { courier, trackingNumber } = req.params;
    const config = getConfig();
    const parcel = config.trackers.find(
      (p) => p.courier.toLowerCase() === courier.toLowerCase() && p.tracking_number.toLowerCase() === trackingNumber.toLowerCase()
    );
    if (!parcel) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    try {
      const result = await trackParcel(courier as CourierName, trackingNumber);
      const state = getState();
      const key = `${courier.toLowerCase()}:${trackingNumber}`;
      const lastEvent = result.history?.[0]?.timestamp || '';
      state[key] = {
        ...state[key],
        status: result.status,
        last_checked: new Date().toISOString(),
        location: result.location,
        last_event_time: lastEvent,
        history: result.history,
        customer: result.customer,
        delivered_at: result.delivered ? (state[key]?.delivered_at || new Date().toISOString()) : state[key]?.delivered_at
      };
      saveState(state);

      const notifyRes = await notifyParcel(
        parcel.name,
        parcel.courier,
        parcel.tracking_number,
        result.status,
        result.location,
        result.history
      );
      if (isB2Configured()) {
        await putB2State(getState()).catch(() => {});
      }
      res.json({ success: notifyRes.success, error: notifyRes.error, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Notification failed' });
    }
  });

  app.delete('/api/parcels/:courier/:trackingNumber', async (req, res) => {
    try {
      const courier = decodeURIComponent(req.params.courier || '').trim().toLowerCase();
      const trackingNumber = decodeURIComponent(req.params.trackingNumber || '').trim().toLowerCase();
      
      const config = getConfig();
      const initialLen = config.trackers.length;

      config.trackers = config.trackers.filter(
        (p) => !(p.courier.toLowerCase() === courier && p.tracking_number.trim().toLowerCase() === trackingNumber)
      );

      if (config.trackers.length === initialLen) {
        return res.status(404).json({ error: 'Parcel not found in tracked list' });
      }

      saveConfig(config);

      // Also clean up from state (match all variations of keys)
      const state = getState();
      Object.keys(state).forEach((k) => {
        const [c, ...rest] = k.split(':');
        const num = rest.join(':').trim().toLowerCase();
        if (c.toLowerCase() === courier && num === trackingNumber) {
          delete state[k];
        }
      });
      delete state[`${courier}:${trackingNumber}`];
      saveState(state);

      // Explicitly sync to B2
      if (isB2Configured()) {
        try {
          await Promise.all([
            putB2Config(config),
            putB2State(state)
          ]);
          console.log(`[B2] Deleted parcel ${courier}:${trackingNumber} from B2 config and state.`);
        } catch (b2Err) {
          console.error('[B2] Failed to upload deletion to B2:', b2Err);
        }
      }

      res.json({ success: true, remainingCount: config.trackers.length, b2Synced: isB2Configured() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete parcel' });
    }
  });

  // Body-based delete endpoint for clients that prefer POST/DELETE with JSON payload
  app.post('/api/parcels/delete', async (req, res) => {
    try {
      const courier = String(req.body?.courier || '').trim().toLowerCase();
      const trackingNumber = String(req.body?.tracking_number || req.body?.trackingNumber || '').trim().toLowerCase();

      if (!courier || !trackingNumber) {
        return res.status(400).json({ error: 'courier and tracking_number are required' });
      }

      const config = getConfig();
      const initialLen = config.trackers.length;

      config.trackers = config.trackers.filter(
        (p) => !(p.courier.toLowerCase() === courier && p.tracking_number.trim().toLowerCase() === trackingNumber)
      );

      if (config.trackers.length === initialLen) {
        return res.status(404).json({ error: 'Parcel not found in tracked list' });
      }

      saveConfig(config);

      const state = getState();
      Object.keys(state).forEach((k) => {
        const [c, ...rest] = k.split(':');
        const num = rest.join(':').trim().toLowerCase();
        if (c.toLowerCase() === courier && num === trackingNumber) {
          delete state[k];
        }
      });
      delete state[`${courier}:${trackingNumber}`];
      saveState(state);

      if (isB2Configured()) {
        try {
          await Promise.all([
            putB2Config(config),
            putB2State(state)
          ]);
        } catch (b2Err) {
          console.error('[B2] Failed to sync deletion:', b2Err);
        }
      }

      res.json({ success: true, remainingCount: config.trackers.length, b2Synced: isB2Configured() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to delete parcel' });
    }
  });

  app.post('/api/track-all', async (req, res) => {
    try {
      const sendNotifications = req.body?.sendNotifications !== false;
      const result = await trackAllParcels({ sendNotifications });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to track parcels' });
    }
  });

  app.post('/api/track-one', async (req, res) => {
    const { courier, tracking_number } = req.body;
    if (!courier || !tracking_number) {
      return res.status(400).json({ error: 'courier and tracking_number are required' });
    }
    try {
      const result = await trackParcel(courier as CourierName, tracking_number);
      const config = getConfig();
      const trackedParcel = config.trackers.find(
        (p) =>
          p.courier.toLowerCase() === courier.toLowerCase() &&
          p.tracking_number.trim().toLowerCase() === String(tracking_number).trim().toLowerCase()
      );

      if (trackedParcel && !result.error) {
        const state = getState();
        const key = `${trackedParcel.courier.toLowerCase()}:${trackedParcel.tracking_number}`;
        const existing = state[key];
        const baselineStatus = existing?.last_notified_status ?? existing?.status ?? '';
        const lastEvent = result.history?.[0]?.timestamp || '';
        const statusChanged = result.status !== baselineStatus;
        const unnotifiedDelivery = result.delivered && existing?.delivered_notified === false;

        state[key] = {
          ...existing,
          status: result.status,
          last_checked: new Date().toISOString(),
          location: result.location,
          last_event_time: lastEvent || existing?.last_event_time,
          history: result.history,
          customer: result.customer
        };
        if (result.delivered && !state[key].delivered_at) {
          state[key].delivered_at = new Date().toISOString();
        }
        saveState(state);

        if (statusChanged || unnotifiedDelivery || !existing?.notified_once) {
          await notifyParcel(
            trackedParcel.name,
            trackedParcel.courier,
            trackedParcel.tracking_number,
            result.status,
            result.location,
            result.history
          ).catch(() => {});
        }
        if (isB2Configured()) {
          await putB2State(getState()).catch(() => {});
        }
      }

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Tracking failed' });
    }
  });

  app.post('/api/ntfy/test', async (req, res) => {
    const config = getConfig();
    const { message, title, priority } = req.body || {};
    const notifyRes = await sendNtfy(
      config,
      title || 'Test Notification from Parcel Tracker',
      message || 'Parcel Tracker ntfy integration is working properly! 📦',
      priority || 'default',
      ['white_check_mark', 'package']
    );
    res.json(notifyRes);
  });

  app.get('/api/state', (req, res) => {
    res.json(getState());
  });

  // Frontend integration
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  // Periodic background check every 30 minutes
  setInterval(() => {
    trackAllParcels({ sendNotifications: true }).catch((err) => {
      console.warn('[Auto-Track] Error in periodic check:', err);
    });
  }, 30 * 60 * 1000);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📦 Parcel Tracker server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Parcel Tracker server:', err);
  process.exit(1);
});
