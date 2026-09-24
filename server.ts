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
  notifyParcel
} from './src/server/engine.ts';
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

  // API Routes
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/config', (req, res) => {
    res.json(getConfig());
  });

  app.post('/api/config', (req, res) => {
    const updated = req.body;
    if (!updated || !Array.isArray(updated.trackers) || !updated.ntfy) {
      return res.status(400).json({ error: 'Invalid config payload' });
    }
    const saved = saveConfig(updated);
    res.json(saved);
  });

  app.get('/api/parcels', (req, res) => {
    const config = getConfig();
    const state = getState();

    const parcelsWithState = config.trackers.map((p) => {
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
      lastUpdated: new Date().toISOString()
    });
  });

  app.post('/api/parcels', (req, res) => {
    const { name, courier, tracking_number } = req.body;
    if (!name || !courier || !tracking_number) {
      return res.status(400).json({ error: 'name, courier, and tracking_number are required' });
    }

    const config = getConfig();
    const exists = config.trackers.find(
      (p) => p.courier === courier.toLowerCase() && p.tracking_number === tracking_number.trim()
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

    // Initial track & notify in background
    (async () => {
      try {
        const res = await trackParcel(newParcel.courier, newParcel.tracking_number);
        const state = getState();
        const key = `${newParcel.courier}:${newParcel.tracking_number}`;
        state[key] = {
          status: res.status,
          last_checked: new Date().toISOString(),
          location: res.location,
          history: res.history,
          customer: res.customer
        };
        saveState(state);
        await notifyParcel(newParcel.name, newParcel.courier, newParcel.tracking_number, res.status, res.location, res.history);
      } catch (e) {
        console.warn('Initial tracking/notification error:', e);
      }
    })();

    res.json({ success: true, parcel: newParcel });
  });

  app.post('/api/parcels/:courier/:trackingNumber/notify', async (req, res) => {
    const { courier, trackingNumber } = req.params;
    const config = getConfig();
    const parcel = config.trackers.find(
      (p) => p.courier.toLowerCase() === courier.toLowerCase() && p.tracking_number === trackingNumber
    );
    if (!parcel) {
      return res.status(404).json({ error: 'Parcel not found' });
    }

    try {
      const result = await trackParcel(courier as CourierName, trackingNumber);
      const state = getState();
      const key = `${courier.toLowerCase()}:${trackingNumber}`;
      state[key] = {
        status: result.status,
        last_checked: new Date().toISOString(),
        location: result.location,
        history: result.history,
        customer: result.customer
      };
      saveState(state);

      const sent = await notifyParcel(
        parcel.name,
        parcel.courier,
        parcel.tracking_number,
        result.status,
        result.location,
        result.history
      );
      res.json({ success: sent, result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Notification failed' });
    }
  });

  app.delete('/api/parcels/:courier/:trackingNumber', (req, res) => {
    const { courier, trackingNumber } = req.params;
    const config = getConfig();
    const initialLen = config.trackers.length;

    config.trackers = config.trackers.filter(
      (p) => !(p.courier.toLowerCase() === courier.toLowerCase() && p.tracking_number === trackingNumber)
    );

    if (config.trackers.length === initialLen) {
      return res.status(404).json({ error: 'Parcel not found in config' });
    }

    saveConfig(config);

    // Also remove from state
    const state = getState();
    const key = `${courier.toLowerCase()}:${trackingNumber}`;
    delete state[key];
    saveState(state);

    res.json({ success: true });
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
      // update state
      const state = getState();
      const key = `${courier.toLowerCase()}:${tracking_number}`;
      state[key] = {
        status: result.status,
        last_checked: new Date().toISOString(),
        location: result.location,
        history: result.history,
        customer: result.customer
      };
      if (result.delivered && !state[key].delivered_at) {
        state[key].delivered_at = new Date().toISOString();
      }
      saveState(state);

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Tracking failed' });
    }
  });

  app.post('/api/ntfy/test', async (req, res) => {
    const config = getConfig();
    const { message, title, priority } = req.body || {};
    const success = await sendNtfy(
      config,
      title || 'Test Notification from Parcel Tracker',
      message || 'Parcel Tracker ntfy integration is working properly! 📦',
      priority || 'default',
      ['white_check_mark', 'package']
    );
    res.json({ success });
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
