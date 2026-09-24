import React, { useState, useEffect } from 'react';
import {
  Package,
  Truck,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Plus,
  Trash2,
  Bell,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Search,
  Copy,
  Check,
  Send,
  Clock,
  MapPin,
  ShieldCheck,
  Boxes
} from 'lucide-react';

interface HistoryItem {
  timestamp: string;
  status: string;
  location?: string;
  step?: number;
  completed?: boolean;
}

interface ParcelState {
  status?: string;
  location?: string;
  last_checked?: string;
  delivered_at?: string;
  removed?: boolean;
  history?: HistoryItem[];
  customer?: string;
}

interface Parcel {
  name: string;
  courier: string;
  tracking_number: string;
  state: ParcelState;
}

interface NtfyConfig {
  server: string;
  topic: string;
  priority: string;
  tags: string[];
}

interface Config {
  trackers: Array<{ name: string; courier: string; tracking_number: string }>;
  ntfy: NtfyConfig;
}

const COURIER_META: Record<string, { label: string; color: string; bg: string; border: string }> = {
  tcs: { label: 'TCS Express', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  leopards: { label: 'Leopards', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30' },
  postex: { label: 'PostEx', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/30' },
  daraz: { label: 'Daraz', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30' },
  dex: { label: 'DEX Express', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30' },
  trax: { label: 'Trax Logistics', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/30' },
};

export default function App() {
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [summary, setSummary] = useState<string>('');
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingAll, setTrackingAll] = useState(false);
  const [trackingSingle, setTrackingSingle] = useState<string | null>(null);
  const [notifyingKey, setNotifyingKey] = useState<string | null>(null);
  const [notifySuccessKey, setNotifySuccessKey] = useState<string | null>(null);
  const [notifyErrorKey, setNotifyErrorKey] = useState<{ key: string; error: string } | null>(null);
  const [expandedParcel, setExpandedParcel] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New Parcel Form
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCourier, setNewCourier] = useState('tcs');
  const [newTrackingNumber, setNewTrackingNumber] = useState('');
  const [addError, setAddError] = useState('');

  // Ntfy modal & status
  const [showNtfyModal, setShowNtfyModal] = useState(false);
  const [ntfyServer, setNtfyServer] = useState('');
  const [ntfyTopic, setNtfyTopic] = useState('');
  const [ntfyPriority, setNtfyPriority] = useState('default');
  const [testingNtfy, setTestingNtfy] = useState(false);
  const [ntfyMsg, setNtfyMsg] = useState('');

  // Quick lookup tool
  const [quickCourier, setQuickCourier] = useState('dex');
  const [quickNumber, setQuickNumber] = useState('');
  const [quickResult, setQuickResult] = useState<any>(null);
  const [quickLoading, setQuickLoading] = useState(false);

  const fetchParcels = async () => {
    try {
      const res = await fetch('/api/parcels');
      const data = await res.json();
      setParcels(data.parcels || []);
      setSummary(data.summary || '');
    } catch (err) {
      console.error('Failed to load parcels:', err);
    }
  };

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data);
      if (data.ntfy) {
        setNtfyServer(data.ntfy.server || 'https://ntfy.sh');
        setNtfyTopic(data.ntfy.topic || '');
        setNtfyPriority(data.ntfy.priority || 'default');
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  };

  useEffect(() => {
    Promise.all([fetchParcels(), fetchConfig()]).finally(() => setLoading(false));
  }, []);

  const handleTrackAll = async () => {
    setTrackingAll(true);
    try {
      const res = await fetch('/api/track-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendNotifications: true })
      });
      const data = await res.json();
      await fetchParcels();
    } catch (err) {
      console.error('Track all failed:', err);
    } finally {
      setTrackingAll(false);
    }
  };

  const handleTrackOne = async (courier: string, trackingNumber: string) => {
    const key = `${courier}:${trackingNumber}`;
    setTrackingSingle(key);
    try {
      await fetch('/api/track-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courier, tracking_number: trackingNumber })
      });
      await fetchParcels();
    } catch (err) {
      console.error('Single track failed:', err);
    } finally {
      setTrackingSingle(null);
    }
  };

  const handleNotifyParcel = async (courier: string, trackingNumber: string) => {
    const key = `${courier}:${trackingNumber}`;
    setNotifyingKey(key);
    setNotifyErrorKey(null);
    try {
      const res = await fetch(`/api/parcels/${courier}/${trackingNumber}/notify`, {
        method: 'POST'
      });
      const data = await res.json();
      if (data.success) {
        setNotifySuccessKey(key);
        setTimeout(() => setNotifySuccessKey(null), 3000);
      } else {
        setNotifyErrorKey({ key, error: data.error || 'Failed to send notification' });
        setTimeout(() => setNotifyErrorKey(null), 5000);
      }
      await fetchParcels();
    } catch (err: any) {
      console.error('Notify parcel failed:', err);
      setNotifyErrorKey({ key, error: err.message || 'Network error' });
      setTimeout(() => setNotifyErrorKey(null), 5000);
    } finally {
      setNotifyingKey(null);
    }
  };

  const handleDeleteParcel = async (courier: string, trackingNumber: string) => {
    if (!confirm(`Stop tracking ${courier.toUpperCase()} parcel #${trackingNumber}?`)) return;
    try {
      await fetch(`/api/parcels/${courier}/${trackingNumber}`, { method: 'DELETE' });
      await fetchParcels();
      await fetchConfig();
    } catch (err) {
      console.error('Delete parcel failed:', err);
    }
  };

  const handleAddParcel = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!newName.trim() || !newTrackingNumber.trim()) {
      setAddError('Please fill in both name and tracking number');
      return;
    }

    try {
      const res = await fetch('/api/parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          courier: newCourier,
          tracking_number: newTrackingNumber.trim()
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAddError(data.error || 'Failed to add parcel');
        return;
      }

      setNewName('');
      setNewTrackingNumber('');
      setShowAddModal(false);
      await fetchParcels();
      await fetchConfig();

      // Immediately trigger tracking on the new parcel
      handleTrackOne(newCourier, newTrackingNumber.trim());
    } catch (err: any) {
      setAddError(err.message || 'Network error');
    }
  };

  const handleSaveNtfy = async () => {
    if (!config) return;
    const updated = {
      ...config,
      ntfy: {
        ...config.ntfy,
        server: ntfyServer.trim(),
        topic: ntfyTopic.trim(),
        priority: ntfyPriority
      }
    };
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      setConfig(data);
      setShowNtfyModal(false);
    } catch (err) {
      console.error('Failed to save ntfy config:', err);
    }
  };

  const handleTestNtfy = async () => {
    setTestingNtfy(true);
    setNtfyMsg('');
    try {
      const res = await fetch('/api/ntfy/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Parcel Tracker Test Notification',
          message: 'Notifications are connected! You will receive hourly updates whenever status changes.'
        })
      });
      const data = await res.json();
      if (data.success) {
        setNtfyMsg('Notification sent successfully!');
      } else {
        setNtfyMsg(`Failed: ${data.error || 'Please verify topic name.'}`);
      }
    } catch {
      setNtfyMsg('Connection error sending notification');
    } finally {
      setTestingNtfy(false);
    }
  };

  const handleQuickLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickNumber.trim()) return;
    setQuickLoading(true);
    setQuickResult(null);
    try {
      const res = await fetch('/api/track-one', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courier: quickCourier,
          tracking_number: quickNumber.trim()
        })
      });
      const data = await res.json();
      setQuickResult(data);
    } catch (err: any) {
      setQuickResult({ error: err.message || 'Lookup failed' });
    } finally {
      setQuickLoading(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Stats calculation
  const totalCount = parcels.length;
  const deliveredCount = parcels.filter(
    (p) => p.state.status && p.state.status.toLowerCase().includes('delivered')
  ).length;
  const inTransitCount = parcels.filter(
    (p) =>
      p.state.status &&
      !p.state.status.toLowerCase().includes('delivered') &&
      !p.state.status.startsWith('ERROR:')
  ).length;
  const errorCount = parcels.filter((p) => p.state.status && p.state.status.startsWith('ERROR:')).length;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Navbar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Boxes className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
                Parcel Tracker
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Live
                </span>
              </h1>
              <p className="text-xs text-slate-400">Automated courier tracking with ntfy.sh alerts</p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowNtfyModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
              title="ntfy.sh Settings"
            >
              <Bell className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">Alerts</span>
              {config?.ntfy?.topic && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              )}
            </button>

            <button
              onClick={handleTrackAll}
              disabled={trackingAll}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow shadow-indigo-600/30 transition disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${trackingAll ? 'animate-spin' : ''}`} />
              <span>{trackingAll ? 'Tracking...' : 'Track All'}</span>
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow shadow-emerald-600/30 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Parcel</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* ntfy Live Topic Status Banner */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-indigo-950/80 to-slate-900 border border-indigo-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs shadow-lg shadow-indigo-950/20">
          <div className="flex items-center gap-2.5 text-slate-200">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
              <Bell className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div>
              <div className="font-semibold text-white flex items-center gap-2">
                <span>Active ntfy Topic:</span>
                <code className="px-2 py-0.5 rounded bg-slate-950 text-indigo-300 font-mono text-[11px] border border-indigo-500/20">
                  {config?.ntfy?.topic || 'parcel-tracker-rehanbabar'}
                </code>
              </div>
              <p className="text-[11px] text-slate-400">
                Hourly and status-change push notifications are dispatched to this channel.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <a
              href={`${config?.ntfy?.server || 'https://ntfy.sh'}/${config?.ntfy?.topic || 'parcel-tracker-rehanbabar'}`}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-[11px] inline-flex items-center gap-1.5 transition shadow shadow-indigo-600/20"
            >
              <span>View Alerts Channel</span>
              <ExternalLink className="w-3 h-3" />
            </a>
            <button
              onClick={() => setShowNtfyModal(true)}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium border border-slate-700 transition"
            >
              Configure Topic
            </button>
          </div>
        </div>

        {/* Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Total Parcels</span>
              <Package className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold text-white">{totalCount}</div>
            <p className="text-[11px] text-slate-500 mt-1">Monitored couriers</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>In Transit</span>
              <Truck className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-cyan-400">{inTransitCount}</div>
            <p className="text-[11px] text-slate-500 mt-1">Active deliveries</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Delivered</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400">{deliveredCount}</div>
            <p className="text-[11px] text-slate-500 mt-1">Kept 48h in summary</p>
          </div>

          <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800">
            <div className="flex items-center justify-between text-slate-400 text-xs font-medium mb-1">
              <span>Errors / Needs Scan</span>
              <AlertCircle className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-amber-400">{errorCount}</div>
            <p className="text-[11px] text-slate-500 mt-1">Awaiting updates</p>
          </div>
        </div>

        {/* Courier Support Badges */}
        <div className="p-3.5 rounded-xl bg-slate-900/40 border border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400 font-medium">
            <ShieldCheck className="w-4 h-4 text-indigo-400" />
            <span>Supported Courier Networks:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(COURIER_META).map(([code, meta]) => (
              <span
                key={code}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${meta.bg} ${meta.color} ${meta.border}`}
              >
                {meta.label}
              </span>
            ))}
          </div>
        </div>

        {/* Quick Instant Tracker Bar */}
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
          <h2 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
            <Search className="w-4 h-4 text-indigo-400" />
            Quick Courier Lookup (One-off check)
          </h2>
          <form onSubmit={handleQuickLookup} className="flex flex-col sm:flex-row gap-2">
            <select
              value={quickCourier}
              onChange={(e) => setQuickCourier(e.target.value)}
              className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
            >
              <option value="tcs">TCS Express</option>
              <option value="leopards">Leopards Courier</option>
              <option value="postex">PostEx</option>
              <option value="daraz">Daraz</option>
              <option value="dex">DEX Express</option>
              <option value="trax">Trax Logistics</option>
            </select>
            <input
              type="text"
              placeholder="Enter tracking number (e.g. 12345678)..."
              value={quickNumber}
              onChange={(e) => setQuickNumber(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={quickLoading || !quickNumber.trim()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-lg text-xs font-semibold border border-slate-700 transition disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {quickLoading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Search className="w-3.5 h-3.5 text-indigo-400" />
              )}
              <span>Query API</span>
            </button>
          </form>

          {/* Quick Lookup Result Panel */}
          {quickResult && (
            <div className="mt-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              {quickResult.error ? (
                <div className="text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{quickResult.error}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                    <div className="font-semibold text-white">
                      Status: <span className="text-cyan-400">{quickResult.status}</span>
                    </div>
                    {quickResult.location && quickResult.location !== 'N/A' && (
                      <div className="text-slate-400">Location: {quickResult.location}</div>
                    )}
                    <div className="text-slate-500">
                      Delivered: {quickResult.delivered ? 'Yes' : 'No'}
                    </div>
                  </div>
                  {quickResult.history && quickResult.history.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-slate-400 font-medium">History Checkpoints:</div>
                      {quickResult.history.slice(0, 4).map((h: any, i: number) => (
                        <div key={i} className="text-slate-300 flex items-start gap-2">
                          <span className="text-slate-500 text-[10px] w-24 shrink-0">
                            {h.timestamp || 'Step ' + (i + 1)}
                          </span>
                          <span>{h.status}</span>
                          {h.location && <span className="text-slate-500">({h.location})</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Parcels List */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-indigo-400" />
              Tracked Parcels ({parcels.length})
            </h2>
            <span className="text-xs text-slate-500">Auto-updates on status changes</span>
          </div>

          {loading ? (
            <div className="p-12 text-center text-slate-500 bg-slate-900/30 rounded-xl border border-slate-800 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-indigo-400" />
              <span>Loading tracked parcels...</span>
            </div>
          ) : parcels.length === 0 ? (
            <div className="p-12 text-center bg-slate-900/30 rounded-xl border border-slate-800 flex flex-col items-center justify-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400">
                <Package className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-300">No parcels tracked yet</p>
                <p className="text-xs text-slate-500 mt-1">Add a parcel with your tracking number to start receiving status updates</p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg transition"
              >
                Add Your First Parcel
              </button>
            </div>
          ) : (
            <div className="grid gap-3">
              {parcels.map((parcel) => {
                const key = `${parcel.courier}:${parcel.tracking_number}`;
                const meta = COURIER_META[parcel.courier.toLowerCase()] || {
                  label: parcel.courier.toUpperCase(),
                  color: 'text-slate-300',
                  bg: 'bg-slate-800',
                  border: 'border-slate-700'
                };
                const status = parcel.state?.status || 'Unknown / Not Scanned';
                const location = parcel.state?.location;
                const isDelivered = status.toLowerCase().includes('delivered');
                const isError = status.startsWith('ERROR:');
                const isExpanded = expandedParcel === key;
                const isTracking = trackingSingle === key;

                return (
                  <div
                    key={key}
                    className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 hover:border-slate-700/80 transition"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      {/* Left info */}
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm text-white">{parcel.name}</h3>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${meta.bg} ${meta.color} ${meta.border}`}
                          >
                            {meta.label}
                          </span>
                          {parcel.state?.delivered_at && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Delivered
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                          <span>{parcel.tracking_number}</span>
                          <button
                            onClick={() => copyToClipboard(parcel.tracking_number, key)}
                            className="p-1 hover:text-white rounded"
                            title="Copy tracking number"
                          >
                            {copiedKey === key ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Right status & actions */}
                      <div className="flex flex-wrap items-center gap-3 justify-between sm:justify-end">
                        <div className="text-right">
                          <div
                            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                              isDelivered
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                : isError
                                ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                                : 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                            }`}
                          >
                            {isDelivered ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : isError ? (
                              <AlertCircle className="w-3 h-3" />
                            ) : (
                              <Truck className="w-3 h-3" />
                            )}
                            <span>{status}</span>
                          </div>

                          {location && location !== 'N/A' && (
                            <div className="text-[11px] text-slate-400 flex items-center gap-1 justify-end mt-1">
                              <MapPin className="w-3 h-3 text-slate-500" />
                              <span>{location}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleNotifyParcel(parcel.courier, parcel.tracking_number)}
                            disabled={notifyingKey === key}
                            className={`p-1.5 rounded-lg border transition ${
                              notifySuccessKey === key
                                ? 'bg-emerald-900/40 text-emerald-300 border-emerald-500/50'
                                : 'bg-slate-800 hover:bg-slate-700 text-indigo-300 border-slate-700'
                            }`}
                            title="Send ntfy push notification now"
                          >
                            {notifyingKey === key ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : notifySuccessKey === key ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Bell className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            onClick={() => handleTrackOne(parcel.courier, parcel.tracking_number)}
                            disabled={isTracking}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition disabled:opacity-50"
                            title="Check status now"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isTracking ? 'animate-spin' : ''}`} />
                          </button>

                          <button
                            onClick={() => handleDeleteParcel(parcel.courier, parcel.tracking_number)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-900/30 text-slate-400 hover:text-red-400 border border-slate-700 transition"
                            title="Remove tracking"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => setExpandedParcel(isExpanded ? null : key)}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 transition"
                            title="Toggle history"
                          >
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Error Banner for Notification */}
                    {notifyErrorKey?.key === key && (
                      <div className="mt-2 p-2 bg-red-900/30 border border-red-500/40 rounded-lg text-red-300 text-xs flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-400" />
                          <span>Notification Error: {notifyErrorKey.error}</span>
                        </div>
                        <button
                          onClick={() => setNotifyErrorKey(null)}
                          className="text-red-400 hover:text-red-200 text-xs px-1"
                        >
                          ✕
                        </button>
                      </div>
                    )}

                    {/* Expandable History Timeline */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-slate-800 text-xs space-y-2">
                        <div className="flex items-center justify-between text-slate-400 text-[11px] font-medium">
                          <span>Tracking History</span>
                          {parcel.state?.last_checked && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Checked {new Date(parcel.state.last_checked).toLocaleTimeString()}
                            </span>
                          )}
                        </div>

                        {parcel.state?.history && parcel.state.history.length > 0 ? (
                          <div className="relative pl-4 space-y-2.5 border-l border-slate-800 ml-1 mt-2">
                            {parcel.state.history.map((h, idx) => (
                              <div key={idx} className="relative group">
                                <div className="absolute -left-[21px] top-1 w-2.5 h-2.5 rounded-full bg-slate-700 group-hover:bg-indigo-400 transition"></div>
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                                  <span className="font-medium text-slate-200">{h.status}</span>
                                  {h.timestamp && (
                                    <span className="text-[11px] text-slate-500 font-mono">
                                      {h.timestamp}
                                    </span>
                                  )}
                                </div>
                                {h.location && (
                                  <div className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                                    <MapPin className="w-2.5 h-2.5" /> {h.location}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-slate-500 text-xs italic">
                            No checkpoint history available from courier API yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Status Notification Summary Preview */}
        {summary && (
          <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-indigo-400" />
              ntfy Notification Summary Preview
            </h3>
            <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 text-[11px] font-mono text-slate-300 whitespace-pre-wrap">
              {summary}
            </pre>
          </div>
        )}
      </main>

      {/* Add Parcel Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-emerald-400" />
                Add Parcel for Tracking
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddParcel} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Parcel Name / Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Mechanical Keyboard, Daraz 11.11 Order"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Courier Provider
                </label>
                <select
                  value={newCourier}
                  onChange={(e) => setNewCourier(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500 font-medium"
                >
                  <option value="tcs">TCS Express</option>
                  <option value="leopards">Leopards Courier</option>
                  <option value="postex">PostEx</option>
                  <option value="daraz">Daraz</option>
                  <option value="dex">DEX (Daraz Express)</option>
                  <option value="trax">Trax Logistics</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Tracking Number / CN Number
                </label>
                <input
                  type="text"
                  placeholder="e.g. 1029384756"
                  value={newTrackingNumber}
                  onChange={(e) => setNewTrackingNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              {addError && (
                <div className="p-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{addError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow shadow-emerald-600/30 transition"
                >
                  Save & Track
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ntfy.sh Settings Modal */}
      {showNtfyModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Bell className="w-4 h-4 text-indigo-400" />
                ntfy.sh Notification Settings
              </h3>
              <button
                onClick={() => setShowNtfyModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <div className="text-xs text-slate-400 space-y-1">
              <p>
                Subscribe to your unique topic in the ntfy app (iOS / Android) or web browser at{' '}
                <a
                  href={`https://ntfy.sh/${ntfyTopic || ''}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline inline-flex items-center gap-1"
                >
                  ntfy.sh/{ntfyTopic || '<topic>'} <ExternalLink className="w-3 h-3" />
                </a>
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ntfy Server
                </label>
                <input
                  type="text"
                  value={ntfyServer}
                  onChange={(e) => setNtfyServer(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  ntfy Topic
                </label>
                <input
                  type="text"
                  placeholder="e.g. my-parcel-tracker-secret123"
                  value={ntfyTopic}
                  onChange={(e) => setNtfyTopic(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Default Priority
                </label>
                <select
                  value={ntfyPriority}
                  onChange={(e) => setNtfyPriority(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                >
                  <option value="min">Min (Quiet)</option>
                  <option value="low">Low</option>
                  <option value="default">Default</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              {ntfyMsg && (
                <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-xs">
                  {ntfyMsg}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleTestNtfy}
                  disabled={testingNtfy || !ntfyTopic.trim()}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition disabled:opacity-50 flex items-center gap-1.5"
                >
                  <Send className="w-3 h-3 text-indigo-400" />
                  <span>{testingNtfy ? 'Sending...' : 'Send Test Alert'}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowNtfyModal(false)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveNtfy}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow shadow-indigo-600/30 transition"
                  >
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
