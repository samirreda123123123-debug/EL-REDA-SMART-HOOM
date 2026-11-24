import { useState, useRef, useEffect, useCallback, CSSProperties } from "react";

/* ══════════════════════════════════════════════
   DATA TYPES
══════════════════════════════════════════════ */

interface ButtonCfg {
  label:   string;
  icon:    string;
  enabled: boolean;
  on:      boolean;
}

interface Device {
  id:      string;
  name:    string;   // e.g. الصالة
  ip:      string;
  buttons: ButtonCfg[];
}

type ModeAction = "on" | "off" | "skip";

interface ModeStep {
  deviceId:    string;
  buttonIndex: number;
  action:      ModeAction;
}

interface SmartMode {
  id:    string;
  name:  string;
  icon:  string;
  steps: ModeStep[];
}

interface EspStatusResponse {
  r1?: number;
  r2?: number;
  r3?: number;
  r4?: number;
  r5?: number;
  r6?: number;
  r7?: number;
  ldr?: number;
}

/* ══════════════════════════════════════════════
   CONSTANTS & STORAGE KEYS
══════════════════════════════════════════════ */

const STORAGE_DEVICES_KEY = "alreda_smarthome_devices_v1";
const STORAGE_MODES_KEY   = "alreda_smarthome_modes_v1";

const DEVICE_OPTIONS = [
  { icon:"💡", label:"إضاءة عامة" },
  { icon:"🕯️", label:"إضاءة هادئة" },
  { icon:"🏮", label:"نور أمام المنزل" },
  { icon:"📺", label:"تلفزيون" },
  { icon:"❄️", label:"مكيف" },
  { icon:"🔒", label:"قفل ذكي" },
  { icon:"📡", label:"راوتر" },
  { icon:"🔌", label:"مقبس كهربائي" },
  { icon:"🌡️", label:"منظم حرارة" },
  { icon:"🎛️", label:"لوحة تحكم" },
  { icon:"🚿", label:"سخان مياه" },
  { icon:"🎵", label:"مكبر صوت" },
  { icon:"🌀", label:"مروحة" },
  { icon:"🔔", label:"جرس الباب" },
];

const makeDefaultButtons = (): ButtonCfg[] => [
  { label:"الإضاءة الرئيسية", icon:"💡", enabled:true,  on:false },
  { label:"الإضاءة الهادئة",  icon:"🕯️", enabled:true,  on:false },
  { label:"نور أمام المنزل",  icon:"🏮", enabled:true,  on:false },
  { label:"التلفزيون",        icon:"📺", enabled:true,  on:false },
  { label:"المكيف",           icon:"❄️", enabled:true,  on:false },
  { label:"القفل الذكي",      icon:"🔒", enabled:true,  on:false },
  { label:"المروحة",          icon:"🌀", enabled:true,  on:false },
];

const mkId = () => Math.random().toString(36).slice(2,8);

const INITIAL_DEVICES: Device[] = [
  { id:mkId(), name:"الصالة",     ip:"192.168.8.200", buttons:makeDefaultButtons() },
  { id:mkId(), name:"غرفة النوم", ip:"192.168.8.201", buttons:makeDefaultButtons() },
];

const makeModeSteps = (devices:Device[], actions:Record<number,ModeAction>):ModeStep[] =>
  devices.flatMap(device =>
    device.buttons.map((_,buttonIndex) => ({
      deviceId:device.id,
      buttonIndex,
      action:actions[buttonIndex] ?? "skip",
    }))
  );

const INITIAL_MODES:SmartMode[] = [
  {
    id:mkId(), name:"وضع النوم", icon:"🌙",
    steps:makeModeSteps(INITIAL_DEVICES,{0:"off",1:"off",2:"off",3:"off",5:"on"}),
  },
  {
    id:mkId(), name:"وضع الصباح", icon:"☀️",
    steps:makeModeSteps(INITIAL_DEVICES,{0:"on",1:"off",2:"off",3:"off"}),
  },
  {
    id:mkId(), name:"وضع المساء", icon:"🌆",
    steps:makeModeSteps(INITIAL_DEVICES,{0:"off",1:"on",2:"on"}),
  },
  {
    id:mkId(), name:"خارج المنزل", icon:"🚪",
    steps:makeModeSteps(INITIAL_DEVICES,{0:"off",1:"off",2:"off",3:"off",4:"off",5:"on"}),
  },
];

const MODE_ICONS = ["🌙","☀️","🌆","🚪","🎬","💤","🏠","✨"];

/* ══════════════════════════════════════════════
   HTTP HELPER (ESP8266 COMMUNICATION)
══════════════════════════════════════════════ */

async function fetchWithTimeout(url: string, timeoutMs = 2000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    return response;
  } finally {
    clearTimeout(id);
  }
}

/* ══════════════════════════════════════════════
   PALETTE
══════════════════════════════════════════════ */

const C = {
  bg:       "linear-gradient(155deg,#0b1740 0%,#071029 45%,#0a1535 100%)",
  surface:  "rgba(255,255,255,0.06)",
  surfaceHover: "rgba(255,255,255,0.09)",
  border:   "rgba(255,255,255,0.10)",
  text:     "#ddeeff",
  textDim:  "rgba(147,197,253,0.65)",
  textMute: "rgba(147,197,253,0.32)",
  blue:     "#3b82f6",
  blueGlow: "rgba(59,130,246,0.35)",
  cyan:     "#60a5fa",
  green:    "#4ade80",
  red:      "#f87171",
};
const MONO: CSSProperties = { fontFamily:"'JetBrains Mono',monospace" };
const inputBase: CSSProperties = {
  background:"rgba(255,255,255,0.07)",
  border:"1px solid rgba(255,255,255,0.13)",
  borderRadius:12, padding:"10px 14px",
  fontSize:14, color:C.text, outline:"none",
  fontFamily:"'Outfit',sans-serif",
};

/* ══════════════════════════════════════════════
   ROOT
══════════════════════════════════════════════ */

type Page = "home" | "settings";

export default function App() {
  const [page, setPage] = useState<Page>("home");

  // تحميل الأجهزة المحفوظة من localStorage
  const [devices, setDevices] = useState<Device[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DEVICES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return INITIAL_DEVICES;
  });

  // تحميل الأوضاع الذكية المحفوظة
  const [modes, setModes] = useState<SmartMode[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MODES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return INITIAL_MODES;
  });

  const [activeId, setActiveId]       = useState(() => devices[0]?.id ?? "");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("devices");
  const [isConnected, setIsConnected] = useState<boolean>(false);

  // حفظ الأجهزة تلقائياً عند أي تغيير
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DEVICES_KEY, JSON.stringify(devices));
    } catch {}
  }, [devices]);

  // حفظ الأوضاع الذكية تلقائياً عند أي تغيير
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODES_KEY, JSON.stringify(modes));
    } catch {}
  }, [modes]);

  const updateDevices = (fn: (d: Device[]) => Device[]) => setDevices(fn);

  // تحديث حالات الـ 7 أزرار بناءً على JSON القادم من ESP8266
  const syncDeviceFromJson = useCallback((devId: string, data: EspStatusResponse) => {
    const states = [
      data.r1 === 1,
      data.r2 === 1,
      data.r3 === 1,
      data.r4 === 1,
      data.r5 === 1,
      data.r6 === 1,
      data.r7 === 1,
    ];
    setDevices(ds => ds.map(d => {
      if (d.id !== devId) return d;
      return {
        ...d,
        buttons: d.buttons.map((b, idx) => ({
          ...b,
          on: states[idx] !== undefined ? states[idx] : b.on,
        })),
      };
    }));
  }, []);

  const activeDevice = devices.find(d => d.id === activeId) ?? devices[0];

  // جلب الحالة دورياً كل 1.5 ثانية لمزامنة ريموت الـ RF 433MHz وحالة الاتصال
  useEffect(() => {
    if (!activeDevice?.ip || page !== "home") return;

    let cancelled = false;

    const pollStatus = async () => {
      try {
        const cleanIp = activeDevice.ip.trim();
        const res = await fetchWithTimeout(`http://${cleanIp}/status`, 1500);
        if (!res.ok) throw new Error("HTTP error");
        const data: EspStatusResponse = await res.json();
        if (!cancelled) {
          setIsConnected(true);
          syncDeviceFromJson(activeDevice.id, data);
        }
      } catch {
        if (!cancelled) {
          setIsConnected(false);
        }
      }
    };

    pollStatus();
    const timer = setInterval(pollStatus, 1500);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeDevice?.id, activeDevice?.ip, page, syncDeviceFromJson]);

  // إرسال أمر Toggle عند الضغط على أي زر من الـ 7 أزرار
  const toggleButton = async (devId: string, btnIdx: number) => {
    const targetDev = devices.find(d => d.id === devId);
    if (!targetDev) return;

    // 1. تحديث فوري للواجهة لاستجابة سريعة للمستخدم
    updateDevices(ds => ds.map(d =>
      d.id !== devId ? d :
      { ...d, buttons: d.buttons.map((b, i) => i !== btnIdx ? b : { ...b, on: !b.on }) }
    ));

    // 2. إرسال الطلب الفعلي إلى ESP-12F (/toggle?ch=1..7)
    try {
      const channel = btnIdx + 1; // 1 to 7
      const cleanIp = targetDev.ip.trim();
      const res = await fetchWithTimeout(`http://${cleanIp}/toggle?ch=${channel}`, 2000);
      if (res.ok) {
        const data: EspStatusResponse = await res.json();
        setIsConnected(true);
        syncDeviceFromJson(devId, data);
      }
    } catch {
      setIsConnected(false);
    }
  };

  // تنفيذ وضع ذكي (Smart Mode) وإرسال أوامر /set لكل خط
  const applyMode = async (mode: SmartMode) => {
    // 1. تحديث الواجهة فوراً
    updateDevices(ds => ds.map(device => ({
      ...device,
      buttons: device.buttons.map((button, buttonIndex) => {
        const step = mode.steps.find(s =>
          s.deviceId === device.id && s.buttonIndex === buttonIndex
        );
        return !step || step.action === "skip"
          ? button
          : { ...button, on: step.action === "on" };
      }),
    })));

    // 2. إرسال أوامر /set?ch=X&state=Y لكل خط غير متخطى
    const activeSteps = mode.steps.filter(s => s.action !== "skip");
    for (const step of activeSteps) {
      const targetDev = devices.find(d => d.id === step.deviceId);
      if (!targetDev) continue;

      const ch = step.buttonIndex + 1;
      const stateVal = step.action === "on" ? 1 : 0;
      const cleanIp = targetDev.ip.trim();

      try {
        const res = await fetchWithTimeout(
          `http://${cleanIp}/set?ch=${ch}&state=${stateVal}`,
          2000
        );
        if (res.ok && targetDev.id === activeDevice?.id) {
          const data: EspStatusResponse = await res.json();
          setIsConnected(true);
          syncDeviceFromJson(targetDev.id, data);
        }
      } catch {
        if (targetDev.id === activeDevice?.id) {
          setIsConnected(false);
        }
      }
    }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg,
      fontFamily:"'Outfit',sans-serif", color:C.text, direction:"rtl" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes slideIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}
        @keyframes dropIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:rgba(147,197,253,0.30)}
        input,button{font-family:'Outfit',sans-serif}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px}
      `}</style>

      {page === "home"
        ? <HomePage
            devices={devices} activeId={activeId}
            setActiveId={setActiveId} toggleButton={toggleButton}
            modes={modes} applyMode={applyMode}
            isConnected={isConnected}
            goSettings={() => { setSettingsTab("devices"); setPage("settings"); }}
            goModeSettings={() => { setSettingsTab("modes"); setPage("settings"); }}
          />
        : <SettingsPage
            devices={devices} activeId={activeId}
            setActiveId={setActiveId} updateDevices={updateDevices}
            modes={modes} setModes={setModes}
            initialTab={settingsTab}
            onBack={() => setPage("home")}
          />
      }
    </div>
  );
}

/* ══════════════════════════════════════════════
   HOME PAGE
══════════════════════════════════════════════ */

function HomePage({ devices, activeId, setActiveId, toggleButton, modes, applyMode, isConnected, goSettings, goModeSettings }:{
  devices:Device[]; activeId:string;
  setActiveId:(id:string)=>void;
  toggleButton:(devId:string, btnIdx:number)=>void;
  modes:SmartMode[];
  applyMode:(mode:SmartMode)=>void;
  isConnected:boolean;
  goSettings:()=>void;
  goModeSettings:()=>void;
}) {
  const dev = devices.find(d=>d.id===activeId) ?? devices[0];
  const visible = dev.buttons.filter(b => b.enabled);
  const active  = dev.buttons.filter(b => b.on && b.enabled).length;
  const [appliedMode,setAppliedMode] = useState<string|null>(null);

  const runMode = (mode:SmartMode) => {
    applyMode(mode);
    setAppliedMode(mode.id);
    setTimeout(()=>setAppliedMode(null),1800);
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      {/* ── Header ── */}
      <div style={{ padding:"44px 22px 16px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:16 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <div style={{ width:8,height:8,borderRadius:"50%",
                background: isConnected ? C.green : C.red,
                boxShadow: isConnected ? `0 0 10px rgba(74,222,128,0.6)` : `0 0 10px rgba(248,113,113,0.6)`,
                animation:"pulse 2s ease-in-out infinite" }} />
              <span style={{ ...MONO, fontSize:11, color: isConnected ? C.textMute : C.red, letterSpacing:"0.08em" }}>
                {isConnected ? `متصل · ${dev.ip}` : `غير متصل · ${dev.ip}`}
              </span>
            </div>
            <div style={{ fontSize:28,fontWeight:700,lineHeight:1.1 }}>الرضا سمارت هوم</div>
            <div style={{ fontSize:13,color:C.textDim,marginTop:7 }}>
              {active} جهاز شغال من {visible.length}
            </div>
          </div>
          <button onClick={goSettings} style={{
            width:46,height:46,borderRadius:14,fontSize:20,cursor:"pointer",
            background:C.surface, border:`1px solid ${C.border}`,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>⚙️</button>
        </div>
      </div>

      {/* ── Smart modes ── */}
      <div style={{ padding:"0 22px 20px" }}>
        <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
          <div>
            <div style={{ fontSize:15,fontWeight:700 }}>الأوضاع الذكية</div>
            <div style={{ fontSize:11,color:C.textMute,marginTop:2 }}>نفّذ عدة أوامر بلمسة واحدة</div>
          </div>
          <button onClick={goModeSettings} style={{
            fontSize:11,color:C.cyan,cursor:"pointer",padding:"6px 10px",
            borderRadius:9,background:"rgba(59,130,246,0.10)",
            border:"1px solid rgba(99,179,255,0.18)",
          }}>برمجة الأوضاع</button>
        </div>
        <div style={{ display:"flex",gap:9,overflowX:"auto",paddingBottom:4 }}>
          {modes.map(mode => {
            const applied = appliedMode===mode.id;
            const commands = mode.steps.filter(s=>s.action!=="skip").length;
            return (
              <button key={mode.id} onClick={()=>runMode(mode)} style={{
                minWidth:158,height:66,padding:"9px 11px 9px 13px",
                borderRadius:16,cursor:"pointer",textAlign:"right",
                flexShrink:0,transition:"all 0.25s",direction:"rtl",
                display:"flex",alignItems:"center",gap:10,
                background:applied
                  ? "linear-gradient(135deg,rgba(34,197,94,0.28),rgba(22,163,74,0.12))"
                  : "linear-gradient(145deg,rgba(59,130,246,0.13),rgba(255,255,255,0.04))",
                border:applied
                  ? "1px solid rgba(74,222,128,0.45)"
                  : "1px solid rgba(99,179,255,0.18)",
                boxShadow:applied ? "0 6px 20px rgba(34,197,94,0.18)" : "0 4px 16px rgba(0,0,0,0.18)",
              }}>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:12,fontWeight:600,color:applied ? C.green : C.text,
                    whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                    {applied ? "تم التفعيل" : mode.name}
                  </div>
                  <div style={{ ...MONO,fontSize:8,color:C.textMute,marginTop:4 }}>
                    {commands} أوامر
                  </div>
                </div>
                <div style={{
                  width:38,height:38,borderRadius:12,flexShrink:0,fontSize:20,
                  display:"flex",alignItems:"center",justifyContent:"center",
                  background:applied ? "rgba(74,222,128,0.12)" : "rgba(59,130,246,0.12)",
                  border:applied ? "1px solid rgba(74,222,128,0.20)" : "1px solid rgba(99,179,255,0.12)",
                }}>
                  {applied ? "✓" : mode.icon}
                </div>
              </button>
            );
          })}
          {modes.length===0 && (
            <button onClick={goModeSettings} style={{
              width:"100%",padding:16,borderRadius:16,cursor:"pointer",
              color:C.textDim,background:C.surface,
              border:"1.5px dashed rgba(99,179,255,0.22)",
            }}>＋ أضف أول وضع ذكي</button>
          )}
        </div>
      </div>

      {/* ── Room selector and controls ── */}
      <div style={{ flex:1,padding:"0 16px 36px" }}>
        <div style={{
          padding:10,borderRadius:24,
          background:"linear-gradient(155deg,rgba(59,130,246,0.08),rgba(255,255,255,0.025))",
          border:"1px solid rgba(99,179,255,0.15)",
          boxShadow:"0 14px 36px rgba(0,0,0,0.18)",
        }}>
          <div style={{
            display:"flex",gap:4,overflowX:"auto",padding:4,
            borderRadius:16,background:"rgba(3,10,30,0.42)",
            border:"1px solid rgba(255,255,255,0.08)",
          }}>
            {devices.map(d => (
              <button key={d.id} onClick={()=>setActiveId(d.id)} style={{
                flex:1,minWidth:110,padding:"10px 16px",borderRadius:12,
                cursor:"pointer",whiteSpace:"nowrap",fontSize:13,fontWeight:600,
                transition:"all 0.2s",
                background:d.id===activeId ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent",
                border:d.id===activeId ? "1px solid rgba(99,179,255,0.45)" : "1px solid transparent",
                color:d.id===activeId ? "#fff" : C.textDim,
                boxShadow:d.id===activeId ? "0 4px 14px rgba(37,99,235,0.35)" : "none",
              }}>{d.name}</button>
            ))}
          </div>

          <div key={dev.id} style={{
            display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
            alignContent:"start",marginTop:10,animation:"dropIn 0.2s ease",
          }}>
            {dev.buttons.map((btn, i) =>
              btn.enabled ? (
                <DeviceCard key={i} btn={btn} onToggle={()=>toggleButton(dev.id, i)} />
              ) : null
            )}
            {/* settings shortcut */}
            <button onClick={goSettings} style={{
              height:126,borderRadius:18,cursor:"pointer",
              background:"rgba(59,130,246,0.025)",
              border:"1.5px dashed rgba(99,179,255,0.16)",
              display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,
            }}>
              <span style={{ fontSize:24,opacity:.35 }}>⚙️</span>
              <span style={{ fontSize:12,color:C.textMute }}>الإعدادات</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeviceCard({ btn, onToggle }:{ btn:ButtonCfg; onToggle:()=>void }) {
  const { icon, label, on } = btn;
  return (
    <button onClick={onToggle} style={{
      height:126,borderRadius:18,padding:"15px 15px 13px",
      display:"flex",flexDirection:"column",justifyContent:"space-between",
      textAlign:"right",direction:"rtl",cursor:"pointer",
      background: on
        ? "linear-gradient(140deg,rgba(59,130,246,0.22),rgba(37,99,235,0.10))"
        : "rgba(255,255,255,0.05)",
      border: on ? "1px solid rgba(99,179,255,0.42)" : "1px solid rgba(255,255,255,0.09)",
      boxShadow: on
        ? "0 0 28px rgba(59,130,246,0.22),0 8px 24px rgba(0,0,0,0.35)"
        : "0 4px 18px rgba(0,0,0,0.28)",
      transition:"all 0.25s ease",
    }}>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
        <ToggleSwitch on={on} />
        <span style={{
          fontSize:26,lineHeight:1,
          filter: on ? "drop-shadow(0 0 10px rgba(96,165,250,0.75))" : "grayscale(0.6) opacity(0.45)",
          transition:"filter 0.3s",
        }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize:13,fontWeight:600,lineHeight:1.3,
          color: on ? C.text : "rgba(255,255,255,0.42)" }}>{label}</div>
        <div style={{ ...MONO,fontSize:10,marginTop:3,
          color: on ? C.cyan : "rgba(255,255,255,0.18)",fontWeight:500 }}>
          {on ? "● ACTIVE" : "○ OFF"}
        </div>
      </div>
    </button>
  );
}

function ToggleSwitch({ on }:{ on:boolean }) {
  return (
    <div style={{
      position:"relative",width:36,height:20,borderRadius:10,flexShrink:0,
      background: on ? "linear-gradient(90deg,#3b82f6,#60a5fa)" : "rgba(255,255,255,0.14)",
      boxShadow: on ? `0 0 14px ${C.blueGlow}` : "none",
      transition:"all 0.25s",
    }}>
      <div style={{
        position:"absolute",top:3,left: on ? 19 : 3,
        width:14,height:14,borderRadius:"50%",
        background: on ? "#fff" : "rgba(255,255,255,0.5)",
        transition:"left 0.25s",
      }} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   SETTINGS PAGE
══════════════════════════════════════════════ */

type SettingsTab = "devices" | "buttons" | "modes";

function SettingsPage({ devices, activeId, setActiveId, updateDevices, modes, setModes, initialTab, onBack }:{
  devices:Device[]; activeId:string;
  setActiveId:(id:string)=>void;
  updateDevices:(fn:(d:Device[])=>Device[])=>void;
  modes:SmartMode[];
  setModes:(fn:(m:SmartMode[])=>SmartMode[])=>void;
  initialTab:SettingsTab;
  onBack:()=>void;
}) {
  const [tab, setTab]     = useState<SettingsTab>(initialTab);
  const [saved, setSaved] = useState(false);

  const dev = devices.find(d=>d.id===activeId) ?? devices[0];

  const saveFlash = () => { setSaved(true); setTimeout(()=>setSaved(false),2000); };

  /* device-level ops */
  const updateDev = (id:string, patch:Partial<Device>) =>
    updateDevices(ds => ds.map(d => d.id===id ? {...d,...patch} : d));

  const addDevice = () => {
    const d:Device = { id:mkId(), name:"جهاز جديد", ip:"192.168.8.202", buttons:makeDefaultButtons() };
    updateDevices(ds=>[...ds,d]);
    setActiveId(d.id);
    setTab("buttons");
  };

  const removeDevice = (id:string) => {
    if(devices.length===1) return;
    updateDevices(ds=>ds.filter(d=>d.id!==id));
    if(activeId===id) setActiveId(devices.find(d=>d.id!==id)!.id);
  };

  /* button-level ops */
  const updateBtn = (btnIdx:number, patch:Partial<ButtonCfg>) =>
    updateDevices(ds => ds.map(d =>
      d.id!==activeId ? d :
      { ...d, buttons: d.buttons.map((b,i)=> i===btnIdx ? {...b,...patch} : b) }
    ));

  /* mode-level ops */
  const addMode = () => {
    const mode:SmartMode = {
      id:mkId(),
      name:"وضع جديد",
      icon:MODE_ICONS[modes.length % MODE_ICONS.length],
      steps:makeModeSteps(devices,{}),
    };
    setModes(ms=>[...ms,mode]);
  };

  const updateMode = (id:string, patch:Partial<SmartMode>) =>
    setModes(ms=>ms.map(mode=>mode.id===id ? {...mode,...patch} : mode));

  const removeMode = (id:string) =>
    setModes(ms=>ms.filter(mode=>mode.id!==id));

  const updateModeStep = (modeId:string, deviceId:string, buttonIndex:number, action:ModeAction) =>
    setModes(ms=>ms.map(mode => {
      if(mode.id!==modeId) return mode;
      const exists = mode.steps.some(step =>
        step.deviceId===deviceId && step.buttonIndex===buttonIndex
      );
      return {
        ...mode,
        steps:exists
          ? mode.steps.map(step =>
              step.deviceId===deviceId && step.buttonIndex===buttonIndex
                ? {...step,action}
                : step
            )
          : [...mode.steps,{deviceId,buttonIndex,action}],
      };
    }));

  const SectionHead = ({ico,txt}:{ico:string;txt:string}) => (
    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
      <span>{ico}</span>
      <span style={{ fontSize:11,fontWeight:600,color:C.textDim,
        letterSpacing:"0.10em",textTransform:"uppercase" }}>{txt}</span>
      <div style={{ flex:1,height:1,background:"rgba(255,255,255,0.08)" }} />
    </div>
  );

  return (
    <div style={{ minHeight:"100vh",display:"flex",flexDirection:"column",
      animation:"slideIn 0.28s cubic-bezier(0.16,1,0.3,1)" }}>

      {/* header */}
      <div style={{ padding:"44px 22px 20px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:14,marginBottom:20 }}>
          <button onClick={onBack} style={{
            width:44,height:44,borderRadius:14,fontSize:18,cursor:"pointer",
            background:C.surface,border:`1px solid ${C.border}`,
            color:C.textDim,display:"flex",alignItems:"center",justifyContent:"center",
          }}>→</button>
          <div>
            <div style={{ fontSize:24,fontWeight:700 }}>الإعدادات</div>
            <div style={{ fontSize:13,color:C.textMute,marginTop:2 }}>إدارة الأجهزة والأزرار</div>
          </div>
        </div>

        {/* tabs */}
        <div style={{ display:"flex",gap:8,
          background:"rgba(255,255,255,0.05)",
          border:`1px solid ${C.border}`,
          borderRadius:14,padding:4 }}>
          {([["devices","📡 الأجهزة"],["buttons","🎛️ الأزرار"],["modes","✨ الأوضاع"]] as const).map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              flex:1,padding:"9px 0",borderRadius:11,cursor:"pointer",
              fontSize:13,fontWeight:600,transition:"all 0.2s",
              background: tab===t ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent",
              border: "none",
              color: tab===t ? "#fff" : C.textDim,
              boxShadow: tab===t ? "0 4px 14px rgba(37,99,235,0.4)" : "none",
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── content ── */}
      <div style={{ flex:1,padding:"0 22px 44px",overflowY:"auto",
        display:"flex",flexDirection:"column",gap:20 }}>

        {tab==="devices" ? (
          <>
            <SectionHead ico="📡" txt="قائمة الأجهزة" />

            {devices.map(d => (
              <DeviceSettingCard key={d.id} device={d}
                active={d.id===activeId}
                onSelect={()=>{ setActiveId(d.id); setTab("buttons"); }}
                onNameChange={v=>updateDev(d.id,{name:v})}
                onIpChange={v=>updateDev(d.id,{ip:v})}
                onRemove={()=>removeDevice(d.id)}
                canRemove={devices.length>1}
              />
            ))}

            <button onClick={addDevice} style={{
              width:"100%",padding:14,borderRadius:16,cursor:"pointer",
              fontSize:14,fontWeight:600,
              background:"rgba(59,130,246,0.10)",
              border:"1.5px dashed rgba(99,179,255,0.30)",
              color:C.cyan,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            }}>
              <span style={{ fontSize:18 }}>＋</span> إضافة جهاز جديد
            </button>
          </>
        ) : tab==="buttons" ? (
          <>
            {/* device selector for buttons tab */}
            <div>
              <SectionHead ico="🏠" txt="اختر الجهاز" />
              <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:4 }}>
                {devices.map(d=>(
                  <button key={d.id} onClick={()=>setActiveId(d.id)} style={{
                    padding:"7px 16px",borderRadius:20,cursor:"pointer",whiteSpace:"nowrap",
                    fontSize:13,fontWeight:600,transition:"all 0.2s",
                    background: d.id===activeId ? "linear-gradient(135deg,#3b82f6,#2563eb)" : C.surface,
                    border: d.id===activeId ? "1px solid rgba(99,179,255,0.5)" : `1px solid ${C.border}`,
                    color: d.id===activeId ? "#fff" : C.textDim,
                  }}>{d.name}</button>
                ))}
              </div>
            </div>

            <div>
              <SectionHead ico="🎛️" txt={`أزرار ${dev.name}`} />
              <div style={{ background:C.surface,border:`1px solid ${C.border}`,
                borderRadius:20,overflow:"hidden" }}>
                {dev.buttons.map((btn,i)=>(
                  <ButtonSettingRow key={i} index={i} btn={btn}
                    last={i===6}
                    onLabelChange={v=>updateBtn(i,{label:v})}
                    onIconChange={v=>updateBtn(i,{icon:v})}
                    onEnabledChange={v=>updateBtn(i,{enabled:v})}
                  />
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div>
              <SectionHead ico="✨" txt="برمجة الأوضاع الذكية" />
              <div style={{
                padding:"12px 14px",borderRadius:15,marginBottom:14,
                background:"rgba(59,130,246,0.08)",
                border:"1px solid rgba(99,179,255,0.16)",
                fontSize:12,lineHeight:1.7,color:C.textDim,
              }}>
                اكتب اسم الوضع، ثم اختر ما يحدث لكل زر عند تشغيله. خيار «بدون تغيير» يحافظ على حالة الزر الحالية.
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:14 }}>
                {modes.map(mode=>(
                  <ModeSettingCard
                    key={mode.id}
                    mode={mode}
                    devices={devices}
                    onNameChange={name=>updateMode(mode.id,{name})}
                    onIconChange={icon=>updateMode(mode.id,{icon})}
                    onStepChange={(deviceId,buttonIndex,action)=>
                      updateModeStep(mode.id,deviceId,buttonIndex,action)
                    }
                    onRemove={()=>removeMode(mode.id)}
                  />
                ))}
              </div>
            </div>
            <button onClick={addMode} style={{
              width:"100%",padding:14,borderRadius:16,cursor:"pointer",
              fontSize:14,fontWeight:600,
              background:"rgba(59,130,246,0.10)",
              border:"1.5px dashed rgba(99,179,255,0.30)",
              color:C.cyan,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
            }}>
              <span style={{ fontSize:18 }}>＋</span> إضافة وضع جديد
            </button>
          </>
        )}

        {/* save */}
        <button onClick={()=>{ saveFlash(); }} style={{
          width:"100%",padding:15,borderRadius:16,cursor:"pointer",
          fontSize:15,fontWeight:600,border:"none",color:"#fff",transition:"all 0.3s",
          background: saved ? "linear-gradient(135deg,#22c55e,#16a34a)" : "linear-gradient(135deg,#3b82f6,#2563eb)",
          boxShadow: saved ? "0 6px 24px rgba(34,197,94,0.40)" : "0 6px 24px rgba(37,99,235,0.45)",
        }}>
          {saved ? "✓ تم الحفظ" : "💾 حفظ الإعدادات"}
        </button>

        <button onClick={onBack} style={{
          width:"100%",padding:13,borderRadius:16,cursor:"pointer",
          fontSize:14,color:C.textDim,
          background:"rgba(255,255,255,0.05)",
          border:"1px solid rgba(255,255,255,0.09)",
        }}>← العودة للرئيسية</button>
      </div>
    </div>
  );
}

/* ── Device card in settings ── */
function DeviceSettingCard({ device,active,onSelect,onNameChange,onIpChange,onRemove,canRemove }:{
  device:Device; active:boolean;
  onSelect:()=>void; onNameChange:(v:string)=>void; onIpChange:(v:string)=>void;
  onRemove:()=>void; canRemove:boolean;
}) {
  const enabledCount = device.buttons.filter(b=>b.enabled).length;
  return (
    <div style={{
      borderRadius:18, overflow:"hidden",
      background: active ? "rgba(59,130,246,0.10)" : C.surface,
      border: active ? "1px solid rgba(99,179,255,0.35)" : `1px solid ${C.border}`,
      transition:"all 0.2s",
    }}>
      {/* top bar */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"14px 16px 10px" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",
            background: active ? C.green : "rgba(255,255,255,0.2)",
            boxShadow: active ? `0 0 8px rgba(74,222,128,0.6)` : "none",
            animation: active ? "pulse 2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize:13,fontWeight:600,color: active ? C.cyan : C.textDim }}>
            {active ? "الجهاز الحالي" : "جهاز"}
          </span>
          <span style={{ ...MONO,fontSize:10,color:C.textMute }}>
            {enabledCount} أزرار مفعّلة
          </span>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <button onClick={onSelect} style={{
            padding:"5px 12px",borderRadius:8,cursor:"pointer",
            fontSize:12,fontWeight:600,
            background:"rgba(59,130,246,0.15)",
            border:"1px solid rgba(99,179,255,0.30)",
            color:C.cyan,
          }}>تعديل الأزرار</button>
          {canRemove && (
            <button onClick={onRemove} style={{
              width:30,height:30,borderRadius:8,cursor:"pointer",
              background:"rgba(248,113,113,0.10)",
              border:"1px solid rgba(248,113,113,0.25)",
              color:C.red,fontSize:14,
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>✕</button>
          )}
        </div>
      </div>

      {/* inputs */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"0 16px 16px" }}>
        <div>
          <div style={{ fontSize:11,color:C.textMute,marginBottom:6 }}>اسم الجهاز</div>
          <input value={device.name} onChange={e=>onNameChange(e.target.value)}
            placeholder="مثال: الصالة"
            style={{ ...inputBase,width:"100%",padding:"9px 12px",fontSize:13 }}
            onFocus={e=>{ e.target.style.borderColor="rgba(99,179,255,0.5)"; e.target.style.background="rgba(59,130,246,0.09)"; }}
            onBlur={e=>{  e.target.style.borderColor="rgba(255,255,255,0.13)"; e.target.style.background="rgba(255,255,255,0.07)"; }}
          />
        </div>
        <div>
          <div style={{ fontSize:11,color:C.textMute,marginBottom:6 }}>عنوان IP</div>
          <input value={device.ip} onChange={e=>onIpChange(e.target.value)}
            placeholder="192.168.8.200"
            style={{ ...inputBase,...MONO,width:"100%",padding:"9px 12px",fontSize:12,letterSpacing:"0.05em" }}
            onFocus={e=>{ e.target.style.borderColor="rgba(99,179,255,0.5)"; e.target.style.background="rgba(59,130,246,0.09)"; }}
            onBlur={e=>{  e.target.style.borderColor="rgba(255,255,255,0.13)"; e.target.style.background="rgba(255,255,255,0.07)"; }}
          />
        </div>
      </div>
    </div>
  );
}

/* ── Button row in settings ── */
function ButtonSettingRow({ index,btn,last,onLabelChange,onIconChange,onEnabledChange }:{
  index:number; btn:ButtonCfg; last:boolean;
  onLabelChange:(v:string)=>void;
  onIconChange:(v:string)=>void;
  onEnabledChange:(v:boolean)=>void;
}) {
  const [open,setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    if(!open) return;
    const h=(e:MouseEvent)=>{ if(ref.current&&!ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown",h);
    return ()=>document.removeEventListener("mousedown",h);
  },[open]);

  return (
    <div style={{
      display:"flex",alignItems:"center",gap:10,
      padding:"13px 16px",
      borderBottom: last ? "none" : "1px solid rgba(255,255,255,0.06)",
      opacity: btn.enabled ? 1 : 0.45,
      transition:"opacity 0.2s",
    }}>
      {/* enable toggle */}
      <button onClick={()=>onEnabledChange(!btn.enabled)} style={{
        width:36,height:20,borderRadius:10,cursor:"pointer",flexShrink:0,
        background: btn.enabled ? "linear-gradient(90deg,#3b82f6,#60a5fa)" : "rgba(255,255,255,0.14)",
        border:"none",position:"relative",
        boxShadow: btn.enabled ? `0 0 12px ${C.blueGlow}` : "none",
        transition:"all 0.25s",
      }}>
        <div style={{
          position:"absolute",top:3,left: btn.enabled ? 19 : 3,
          width:14,height:14,borderRadius:"50%",
          background: btn.enabled ? "#fff" : "rgba(255,255,255,0.5)",
          transition:"left 0.25s",
        }} />
      </button>

      {/* icon picker */}
      <div ref={ref} style={{ position:"relative",flexShrink:0 }}>
        <button onClick={()=>btn.enabled && setOpen(o=>!o)} style={{
          width:40,height:40,borderRadius:11,fontSize:20,cursor: btn.enabled ? "pointer" : "default",
          background: open ? "rgba(59,130,246,0.18)" : "rgba(59,130,246,0.10)",
          border: open ? "1px solid rgba(99,179,255,0.50)" : "1px solid rgba(99,179,255,0.18)",
          display:"flex",alignItems:"center",justifyContent:"center",
          position:"relative",transition:"all 0.2s",
        }}>
          {btn.icon}
          {btn.enabled && (
            <span style={{
              position:"absolute",bottom:1,left:1,fontSize:7,
              background:"rgba(59,130,246,0.85)",borderRadius:3,
              padding:"1px 3px",color:"#fff",lineHeight:1,
            }}>▼</span>
          )}
        </button>

        {open && (
          <div style={{
            position:"absolute",top:48,right:0,zIndex:999,
            background:"#0e1d45",border:"1px solid rgba(99,179,255,0.28)",
            borderRadius:16,padding:10,
            display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,
            boxShadow:"0 16px 48px rgba(0,0,0,0.6)",
            animation:"dropIn 0.18s ease",minWidth:196,
          }}>
            {DEVICE_OPTIONS.map(opt=>(
              <button key={opt.icon} onClick={()=>{ onIconChange(opt.icon); setOpen(false); }}
                title={opt.label} style={{
                  width:40,height:40,borderRadius:10,fontSize:19,cursor:"pointer",
                  background: btn.icon===opt.icon ? "rgba(59,130,246,0.30)" : "rgba(255,255,255,0.05)",
                  border: btn.icon===opt.icon ? "1px solid rgba(99,179,255,0.55)" : "1px solid transparent",
                  display:"flex",alignItems:"center",justifyContent:"center",
                  transition:"background 0.15s",
                }}>{opt.icon}</button>
            ))}
          </div>
        )}
      </div>

      {/* label + index */}
      <div style={{ flex:1 }}>
        <div style={{ ...MONO,fontSize:9,color:C.textMute,marginBottom:4,letterSpacing:"0.06em" }}>
          زر {index+1}
        </div>
        <input value={btn.label} onChange={e=>onLabelChange(e.target.value)}
          disabled={!btn.enabled}
          style={{ ...inputBase,width:"100%",padding:"7px 11px",fontSize:13,
            cursor: btn.enabled ? "text" : "not-allowed" }}
          onFocus={e=>{ e.target.style.borderColor="rgba(99,179,255,0.5)"; e.target.style.background="rgba(59,130,246,0.09)"; }}
          onBlur={e=>{  e.target.style.borderColor="rgba(255,255,255,0.13)"; e.target.style.background="rgba(255,255,255,0.07)"; }}
        />
      </div>

      {/* enabled badge */}
      <div style={{ ...MONO,fontSize:9,
        color: btn.enabled ? C.green : C.textMute,
        flexShrink:0,letterSpacing:"0.05em" }}>
        {btn.enabled ? "ظاهر" : "مخفي"}
      </div>
    </div>
  );
}

/* ── Smart mode card in settings ── */
function ModeSettingCard({ mode,devices,onNameChange,onIconChange,onStepChange,onRemove }:{
  mode:SmartMode;
  devices:Device[];
  onNameChange:(name:string)=>void;
  onIconChange:(icon:string)=>void;
  onStepChange:(deviceId:string,buttonIndex:number,action:ModeAction)=>void;
  onRemove:()=>void;
}) {
  const [expanded,setExpanded] = useState(false);
  const commandCount = mode.steps.filter(step=>step.action!=="skip").length;

  const getAction = (deviceId:string,buttonIndex:number):ModeAction =>
    mode.steps.find(step =>
      step.deviceId===deviceId && step.buttonIndex===buttonIndex
    )?.action ?? "skip";

  return (
    <div style={{
      borderRadius:18,overflow:"hidden",background:C.surface,
      border:`1px solid ${C.border}`,
    }}>
      <div style={{ padding:14 }}>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          <select value={mode.icon} onChange={e=>onIconChange(e.target.value)} style={{
            ...inputBase,width:52,height:42,padding:"0 8px",fontSize:19,cursor:"pointer",
          }} aria-label="أيقونة الوضع">
            {MODE_ICONS.map(icon=><option key={icon} value={icon}>{icon}</option>)}
          </select>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:10,color:C.textMute,marginBottom:5 }}>اسم الوضع</div>
            <input value={mode.name} onChange={e=>onNameChange(e.target.value)}
              placeholder="مثال: وقت النوم"
              style={{ ...inputBase,width:"100%",padding:"8px 11px",fontSize:13 }}
            />
          </div>
          <button onClick={onRemove} style={{
            width:34,height:34,borderRadius:9,cursor:"pointer",flexShrink:0,
            background:"rgba(248,113,113,0.10)",
            border:"1px solid rgba(248,113,113,0.25)",
            color:C.red,fontSize:14,
          }}>✕</button>
        </div>

        <button onClick={()=>setExpanded(value=>!value)} style={{
          width:"100%",marginTop:12,padding:"9px 11px",borderRadius:11,cursor:"pointer",
          display:"flex",alignItems:"center",justifyContent:"space-between",
          background:"rgba(59,130,246,0.08)",
          border:"1px solid rgba(99,179,255,0.15)",color:C.textDim,
        }}>
          <span style={{ fontSize:12,fontWeight:600 }}>
            {expanded ? "إخفاء الأوامر" : "برمجة الأوامر"}
          </span>
          <span style={{ ...MONO,fontSize:9,color:commandCount ? C.cyan : C.textMute }}>
            {commandCount} أوامر {expanded ? "▲" : "▼"}
          </span>
        </button>
      </div>

      {expanded && (
        <div style={{
          borderTop:"1px solid rgba(255,255,255,0.07)",
          padding:"4px 14px 14px",animation:"dropIn 0.18s ease",
        }}>
          {devices.map(device=>(
            <div key={device.id} style={{ marginTop:13 }}>
              <div style={{
                display:"flex",alignItems:"center",gap:7,marginBottom:7,
                fontSize:11,fontWeight:600,color:C.cyan,
              }}>
                <span>🏠</span>
                <span>{device.name}</span>
                <div style={{ flex:1,height:1,background:"rgba(255,255,255,0.06)" }} />
              </div>
              <div style={{ display:"flex",flexDirection:"column",gap:6 }}>
                {device.buttons.map((button,buttonIndex) => {
                  if(!button.enabled) return null;
                  const action = getAction(device.id,buttonIndex);
                  return (
                    <div key={buttonIndex} style={{
                      display:"flex",alignItems:"center",gap:9,
                      padding:"8px 9px",borderRadius:10,
                      background:"rgba(255,255,255,0.035)",
                    }}>
                      <span style={{ fontSize:17 }}>{button.icon}</span>
                      <span style={{ flex:1,fontSize:11,color:C.textDim }}>{button.label}</span>
                      <select value={action}
                        onChange={e=>onStepChange(device.id,buttonIndex,e.target.value as ModeAction)}
                        style={{
                          ...inputBase,width:102,padding:"6px 8px",fontSize:10,cursor:"pointer",
                          color:action==="on" ? C.green : action==="off" ? C.red : C.textMute,
                        }}>
                        <option value="skip">بدون تغيير</option>
                        <option value="on">تشغيل</option>
                        <option value="off">إيقاف</option>
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
