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

type DeviceTypeKey = "smart_home_7ch";
type WifiPreferMode = "home" | "ap";

interface DeviceWifiSettings {
  homeSsid:   string;
  homePass:   string;
  apSsid:     string;
  apPass:     string;
  preferMode: WifiPreferMode;
}

interface Device {
  id:           string;
  name:         string;
  type:         DeviceTypeKey;
  ip:           string;
  buttons:      ButtonCfg[];
  wifiSettings: DeviceWifiSettings;
  rfLearned:    boolean[];
}

type ModeAction = "on" | "off" | "toggle" | "skip";

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

const STORAGE_DEVICES_KEY = "alreda_smarthome_devices_v3";
const STORAGE_MODES_KEY   = "alreda_smarthome_modes_v3";

const DEVICE_TYPES: { key: DeviceTypeKey; label: string; channels: number }[] = [
  { key: "smart_home_7ch", label: "سمارت هوم 7 خطوط", channels: 7 },
];

const DEVICE_OPTIONS = [
  { icon:"💡", label:"إضاءة عامة" },
  { icon:"🕯️", label:"إضاءة هادئة" },
  { icon:"🏮", label:"نور أمام المنزل" },
  { icon:"🔦", label:"كشاف" },
  { icon:"🛋️", label:"إضاءة الصالة" },
  { icon:"🛏️", label:"إضاءة الغرفة" },
  { icon:"📺", label:"تلفزيون" },
  { icon:"❄️", label:"مكيف" },
  { icon:"🌀", label:"مروحة" },
  { icon:"🔒", label:"قفل ذكي" },
  { icon:"🚪", label:"بوابة" },
  { icon:"🪟", label:"ستائر ذكية" },
  { icon:"📡", label:"راوتر" },
  { icon:"🔌", label:"مقبس كهربائي" },
  { icon:"🌡️", label:"منظم حرارة" },
  { icon:"🎛️", label:"لوحة تحكم" },
  { icon:"🚿", label:"سخان مياه" },
  { icon:"☕", label:"ماكينة قهوة" },
  { icon:"🎵", label:"مكبر صوت" },
  { icon:"🔔", label:"جرس الباب" },
  { icon:"📷", label:"كاميرا مراقبة" },
  { icon:"🌿", label:"ري الحديقة" },
  { icon:"🚗", label:"باب الجراج" },
  { icon:"⚡", label:"خط رئيسي" },
];

const MODE_ICONS = [
  "🌙","☀️","🌆","🚪","🎬","💤","🏠","✨",
  "🎉","📖","🍽️","☕","🛡️","⚡","🌿","❄️",
  "🔥","🎵","🎮","🌅","🌌","🚀","💡","🔒"
];

const makeDefaultButtons = (): ButtonCfg[] => [
  { label:"الإضاءة الرئيسية", icon:"💡", enabled:true, on:false },
  { label:"الإضاءة الهادئة",  icon:"🕯️", enabled:true, on:false },
  { label:"نور أمام المنزل",  icon:"🏮", enabled:true, on:false },
  { label:"التلفزيون",        icon:"📺", enabled:true, on:false },
  { label:"المكيف",           icon:"❄️", enabled:true, on:false },
  { label:"القفل الذكي",      icon:"🔒", enabled:true, on:false },
  { label:"المروحة",          icon:"🌀", enabled:true, on:false },
];

const makeDefaultWifiSettings = (): DeviceWifiSettings => ({
  homeSsid:   "My-way",
  homePass:   "HGslduhgfwdv2020",
  apSsid:     "smart",
  apPass:     "smart2020",
  preferMode: "home",
});

const mkId = () => Math.random().toString(36).slice(2,8);

const makeModeSteps = (devices:Device[], actions:Record<number,ModeAction>):ModeStep[] =>
  devices.flatMap(device =>
    device.buttons.map((_,buttonIndex) => ({
      deviceId:device.id,
      buttonIndex,
      action:actions[buttonIndex] ?? "skip",
    }))
  );

/* ══════════════════════════════════════════════
   HTTP & VOICE HELPERS
══════════════════════════════════════════════ */

async function fetchWithTimeout(url: string, timeoutMs = 1500): Promise<Response> {
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

function speakArabic(text: string) {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "ar-EG";
      utter.rate = 1.05;
      window.speechSynthesis.speak(utter);
    }
  } catch {}
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
  amber:    "#fbbf24",
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

  const [devices, setDevices] = useState<Device[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_DEVICES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [modes, setModes] = useState<SmartMode[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_MODES_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const [activeId, setActiveId]       = useState<string>(() => devices[0]?.id ?? "");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("devices");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [pendingKey, setPendingKey]   = useState<string | null>(null);

  const isPollingRef = useRef<boolean>(false);

  useEffect(() => {
    if (devices.length === 0) {
      if (activeId !== "") setActiveId("");
      setIsConnected(false);
    } else if (!devices.some(d => d.id === activeId)) {
      setActiveId(devices[0].id);
    }
  }, [devices, activeId]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_DEVICES_KEY, JSON.stringify(devices));
    } catch {}
  }, [devices]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_MODES_KEY, JSON.stringify(modes));
    } catch {}
  }, [modes]);

  const updateDevices = (fn: (d: Device[]) => Device[]) => setDevices(fn);

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
      const hasChanged = d.buttons.some((b, idx) => b.on !== states[idx]);
      if (!hasChanged) return d;
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

  useEffect(() => {
    if (!activeDevice?.ip || page !== "home") return;

    let cancelled = false;

    const pollStatus = async () => {
      if (isPollingRef.current) return;
      isPollingRef.current = true;
      try {
        const cleanIp = activeDevice.ip.trim();
        const res = await fetchWithTimeout(`http://${cleanIp}/status`, 1000);
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
      } finally {
        isPollingRef.current = false;
      }
    };

    pollStatus();
    const timer = setInterval(pollStatus, 500);

    return () => {
      cancelled = true;
      clearInterval(timer);
      isPollingRef.current = false;
    };
  }, [activeDevice?.id, activeDevice?.ip, page, syncDeviceFromJson]);

  // إرسال أمر Toggle: لا تتغير حالة الزر إلا بعد استلام رد البوردة
  const toggleButton = async (devId: string, btnIdx: number): Promise<boolean> => {
    const targetDev = devices.find(d => d.id === devId);
    if (!targetDev) return false;

    const lockKey = `${devId}-${btnIdx}`;
    if (pendingKey === lockKey) return false;
    setPendingKey(lockKey);

    try {
      const channel = btnIdx + 1;
      const cleanIp = targetDev.ip.trim();
      const res = await fetchWithTimeout(`http://${cleanIp}/toggle?ch=${channel}`, 1500);
      if (!res.ok) throw new Error("Failed");
      const data: EspStatusResponse = await res.json();
      setIsConnected(true);
      syncDeviceFromJson(devId, data);
      return true;
    } catch {
      setIsConnected(false);
      return false;
    } finally {
      setPendingKey(null);
    }
  };

  // إرسال أمر محدد (ON أو OFF) لزر معين
  const setButtonExplicit = async (devId: string, btnIdx: number, turnOn: boolean): Promise<boolean> => {
    const targetDev = devices.find(d => d.id === devId);
    if (!targetDev) return false;

    try {
      const channel = btnIdx + 1;
      const cleanIp = targetDev.ip.trim();
      const res = await fetchWithTimeout(`http://${cleanIp}/set?ch=${channel}&state=${turnOn ? 1 : 0}`, 1500);
      if (!res.ok) throw new Error("Failed");
      const data: EspStatusResponse = await res.json();
      setIsConnected(true);
      syncDeviceFromJson(devId, data);
      return true;
    } catch {
      setIsConnected(false);
      return false;
    }
  };

  // تنفيذ أوامر الوضع الذكي بالترتيب مع دعم (تشغيل / إيقاف / تبديل)
  const applyMode = async (mode: SmartMode): Promise<boolean> => {
    const activeSteps = mode.steps.filter(s => s.action !== "skip");

    if (activeSteps.length === 0) {
      if (!activeDevice?.ip) return false;
      try {
        const res = await fetchWithTimeout(`http://${activeDevice.ip.trim()}/status`, 1200);
        if (res.ok) {
          setIsConnected(true);
          return true;
        }
      } catch {
        setIsConnected(false);
      }
      return false;
    }

    let anySuccess = false;

    // تنفيذ الخطوات بالترتيب خطوة تلو الأخرى
    for (const step of activeSteps) {
      const targetDev = devices.find(d => d.id === step.deviceId);
      if (!targetDev) continue;

      const ch = step.buttonIndex + 1;
      const cleanIp = targetDev.ip.trim();
      const url = step.action === "toggle"
        ? `http://${cleanIp}/toggle?ch=${ch}`
        : `http://${cleanIp}/set?ch=${ch}&state=${step.action === "on" ? 1 : 0}`;

      try {
        const res = await fetchWithTimeout(url, 1500);
        if (res.ok) {
          anySuccess = true;
          const data: EspStatusResponse = await res.json();
          if (targetDev.id === activeDevice?.id) {
            setIsConnected(true);
          }
          syncDeviceFromJson(targetDev.id, data);
        }
      } catch {
        if (targetDev.id === activeDevice?.id) {
          setIsConnected(false);
        }
      }
    }

    return anySuccess;
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg,
      fontFamily:"'Outfit',sans-serif", color:C.text, direction:"rtl" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.35}}
        @keyframes slideIn{from{opacity:0;transform:translateX(18px)}to{opacity:1;transform:translateX(0)}}
        @keyframes dropIn{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
        input::placeholder{color:rgba(147,197,253,0.35)}
        input,button,select{font-family:'Outfit',sans-serif}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.12);border-radius:4px}
      `}</style>

      {page === "home"
        ? <HomePage
            devices={devices} activeId={activeId}
            setActiveId={setActiveId}
            toggleButton={toggleButton}
            setButtonExplicit={setButtonExplicit}
            modes={modes} applyMode={applyMode}
            isConnected={isConnected}
            pendingKey={pendingKey}
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
   HOME PAGE (WITH VOICE ASSISTANT)
══════════════════════════════════════════════ */

function HomePage({ devices, activeId, setActiveId, toggleButton, setButtonExplicit, modes, applyMode, isConnected, pendingKey, goSettings, goModeSettings }:{
  devices:Device[]; activeId:string;
  setActiveId:(id:string)=>void;
  toggleButton:(devId:string, btnIdx:number)=>Promise<boolean>;
  setButtonExplicit:(devId:string, btnIdx:number, turnOn:boolean)=>Promise<boolean>;
  modes:SmartMode[];
  applyMode:(mode:SmartMode)=>Promise<boolean>;
  isConnected:boolean;
  pendingKey:string | null;
  goSettings:()=>void;
  goModeSettings:()=>void;
}) {
  const [appliedMode, setAppliedMode] = useState<string|null>(null);
  const [failedMode, setFailedMode]   = useState<string|null>(null);

  // حالات المساعد الصوتي
  const [isListening, setIsListening]   = useState<boolean>(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const recognitionRef = useRef<any>(null);

  const hasDevices = devices.length > 0;
  const dev = hasDevices ? (devices.find(d=>d.id===activeId) ?? devices[0]) : null;
  const visible = dev ? dev.buttons.filter(b => b.enabled) : [];
  const active  = dev ? dev.buttons.filter(b => b.on && b.enabled).length : 0;

  const runMode = async (mode: SmartMode): Promise<boolean> => {
    if (!isConnected) {
      setFailedMode(mode.id);
      setTimeout(() => setFailedMode(null), 1600);
      return false;
    }

    const success = await applyMode(mode);
    if (success) {
      setAppliedMode(mode.id);
      setTimeout(() => setAppliedMode(null), 1800);
      return true;
    } else {
      setFailedMode(mode.id);
      setTimeout(() => setFailedMode(null), 1600);
      return false;
    }
  };

  // معالجة الأوامر الصوتية بالعربية والرد الصوتي
  const processVoiceCommand = async (transcript: string) => {
    const cmd = transcript.trim();
    if (!cmd) return;

    // 1. التحقق من مطابقة اسم وضع ذكي
    for (const mode of modes) {
      if (cmd.includes(mode.name.trim())) {
        const ok = await runMode(mode);
        const reply = ok
          ? `تم تفعيل ${mode.name}`
          : `عذراً، الجهاز غير متصل لتفعيل ${mode.name}`;
        setVoiceFeedback(`🎙️ "${cmd}" → ${reply}`);
        speakArabic(reply);
        setTimeout(() => setVoiceFeedback(null), 4000);
        return;
      }
    }

    // 2. التحقق من أوامر التشغيل / الإطفاء / التبديل للأزرار
    const isTurnOn  = /(شغل|افتح|نور|قيد|تشغيل)/.test(cmd);
    const isTurnOff = /(اطفي|اقفل|طفي|إيقاف|ايقاف)/.test(cmd);
    const isToggle  = /(بدل|اعكس|غير)/.test(cmd);

    // البحث في الجهاز النشط أولاً ثم باقي الأجهزة
    const orderedDevices = dev
      ? [dev, ...devices.filter(d => d.id !== dev.id)]
      : devices;

    for (const targetDevice of orderedDevices) {
      for (let i = 0; i < targetDevice.buttons.length; i++) {
        const btn = targetDevice.buttons[i];
        if (!btn.enabled) continue;
        if (cmd.includes(btn.label.trim())) {
          let ok = false;
          let reply = "";

          if (isTurnOn) {
            ok = await setButtonExplicit(targetDevice.id, i, true);
            reply = ok ? `تم تشغيل ${btn.label}` : `تعذر الاتصال لتشغيل ${btn.label}`;
          } else if (isTurnOff) {
            ok = await setButtonExplicit(targetDevice.id, i, false);
            reply = ok ? `تم إيقاف ${btn.label}` : `تعذر الاتصال لإيقاف ${btn.label}`;
          } else if (isToggle || true) {
            ok = await toggleButton(targetDevice.id, i);
            reply = ok ? `تم تبديل حالة ${btn.label}` : `تعذر الاتصال بالبوردة`;
          }

          setVoiceFeedback(`🎙️ "${cmd}" → ${reply}`);
          speakArabic(reply);
          setTimeout(() => setVoiceFeedback(null), 4000);
          return;
        }
      }
    }

    const notFoundReply = "لم أتعرف على اسم الجهاز أو الوضع، حاول مرة أخرى";
    setVoiceFeedback(`🎙️ "${cmd}" → ${notFoundReply}`);
    speakArabic(notFoundReply);
    setTimeout(() => setVoiceFeedback(null), 4000);
  };

  const startVoiceControl = () => {
    if (!hasDevices) {
      const msg = "يرجى إضافة جهاز من الإعدادات أولاً";
      setVoiceFeedback(msg);
      speakArabic(msg);
      setTimeout(() => setVoiceFeedback(null), 3000);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      const msg = "التعرف الصوتي غير مدعوم على هذا الجهاز";
      setVoiceFeedback(msg);
      speakArabic(msg);
      setTimeout(() => setVoiceFeedback(null), 3500);
      return;
    }

    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
      setIsListening(false);
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognitionRef.current = recognition;
      recognition.lang = "ar-EG";
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        setIsListening(true);
        setVoiceFeedback("🎙️ جاري الاستماع... تحدث بأمرك الآن");
      };

      recognition.onresult = (event: any) => {
        const spokenText = event.results[0][0].transcript;
        setIsListening(false);
        processVoiceCommand(spokenText);
      };

      recognition.onerror = () => {
        setIsListening(false);
        setVoiceFeedback("تعذر سماع الصوت، تأكد من إذن الميكروفون وحاول مجدداً");
        setTimeout(() => setVoiceFeedback(null), 3500);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
    } catch {
      setIsListening(false);
    }
  };

  return (
    <div style={{ minHeight:"100vh", display:"flex", flexDirection:"column" }}>
      {/* ── Header ── */}
      <div style={{ padding:"44px 22px 16px" }}>
        <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:12 }}>
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
              <div style={{ width:8,height:8,borderRadius:"50%",
                background: !hasDevices ? C.textMute : isConnected ? C.green : C.red,
                boxShadow: !hasDevices ? "none" : isConnected ? `0 0 10px rgba(74,222,128,0.6)` : `0 0 10px rgba(248,113,113,0.6)`,
                animation: hasDevices ? "pulse 2s ease-in-out infinite" : "none" }} />
              <span style={{ ...MONO, fontSize:11,
                color: !hasDevices ? C.textMute : isConnected ? C.textMute : C.red,
                letterSpacing:"0.08em" }}>
                {!hasDevices
                  ? "لا توجد أجهزة مضافة"
                  : isConnected
                    ? `متصل · ${dev!.ip}`
                    : `غير متصل · ${dev!.ip}`}
              </span>
            </div>
            <div style={{ fontSize:28,fontWeight:700,lineHeight:1.1 }}>الرضا سمارت هوم</div>
            <div style={{ fontSize:13,color:C.textDim,marginTop:7 }}>
              {hasDevices
                ? `${active} جهاز شغال من ${visible.length}`
                : "ابدأ بإضافة أول جهاز من الإعدادات"}
            </div>
          </div>

          {/* أزرار الهيدر: التحدث الصوتي + الإعدادات */}
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={startVoiceControl} title="التحكم الصوتي" style={{
              width:46,height:46,borderRadius:14,fontSize:20,cursor:"pointer",
              background: isListening
                ? "linear-gradient(135deg,#ef4444,#dc2626)"
                : "rgba(59,130,246,0.16)",
              border: isListening
                ? "1px solid rgba(248,113,113,0.6)"
                : "1px solid rgba(99,179,255,0.35)",
              boxShadow: isListening ? "0 0 20px rgba(239,68,68,0.5)" : "none",
              animation: isListening ? "pulse 1s ease-in-out infinite" : "none",
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>🎙️</button>

            <button onClick={goSettings} title="الإعدادات" style={{
              width:46,height:46,borderRadius:14,fontSize:20,cursor:"pointer",
              background:C.surface, border:`1px solid ${C.border}`,
              display:"flex",alignItems:"center",justifyContent:"center",
            }}>⚙️</button>
          </div>
        </div>

        {/* شريط حالة المساعد الصوتي */}
        {voiceFeedback && (
          <div style={{
            padding:"10px 14px", borderRadius:14, marginTop:8,
            background:"rgba(59,130,246,0.15)",
            border:"1px solid rgba(99,179,255,0.35)",
            fontSize:12, color:C.text, lineHeight:1.5,
            animation:"dropIn 0.2s ease",
          }}>
            {voiceFeedback}
          </div>
        )}
      </div>

      {/* ── شاشة الترحيب عند فتح التطبيق لأول مرة بدون أجهزة ── */}
      {!hasDevices ? (
        <div style={{ flex:1, padding:"10px 22px 40px", display:"flex", flexDirection:"column", justifyContent:"center" }}>
          <div style={{
            padding:"28px 22px",
            borderRadius:24,
            background:"linear-gradient(155deg,rgba(59,130,246,0.12),rgba(255,255,255,0.03))",
            border:"1px solid rgba(99,179,255,0.22)",
            boxShadow:"0 14px 36px rgba(0,0,0,0.22)",
            textAlign:"center",
          }}>
            <div style={{
              width:64, height:64, borderRadius:20, margin:"0 auto 16px",
              background:"rgba(59,130,246,0.16)",
              border:"1px solid rgba(99,179,255,0.32)",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:30,
            }}>🏠</div>
            <div style={{ fontSize:19, fontWeight:700, color:C.text, marginBottom:8 }}>
              مرحباً بك في الرضا سمارت هوم
            </div>
            <div style={{ fontSize:13, color:C.textDim, lineHeight:1.75, marginBottom:22 }}>
              لا توجد أي أجهزة أو أزرار أو أوضاع مضافة حتى الآن.
              <br />
              يرجى الدخول إلى الإعدادات لإضافة جهازك وضبط عنوان الـ IP والأزرار.
            </div>
            <button onClick={goSettings} style={{
              width:"100%", padding:"14px 18px", borderRadius:16, cursor:"pointer",
              fontSize:14, fontWeight:700, border:"none", color:"#fff",
              background:"linear-gradient(135deg,#3b82f6,#2563eb)",
              boxShadow:"0 6px 24px rgba(37,99,235,0.45)",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            }}>
              <span>⚙️</span>
              <span>الذهاب إلى الإعدادات لإضافة جهاز</span>
            </button>
          </div>
        </div>
      ) : (
        <>
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
                const applied  = appliedMode === mode.id;
                const failed   = failedMode === mode.id;
                const commands = mode.steps.filter(s=>s.action!=="skip").length;
                return (
                  <button key={mode.id} onClick={()=>runMode(mode)} style={{
                    minWidth:158,height:66,padding:"9px 11px 9px 13px",
                    borderRadius:16,cursor:"pointer",textAlign:"right",
                    flexShrink:0,transition:"all 0.25s",direction:"rtl",
                    display:"flex",alignItems:"center",gap:10,
                    background: applied
                      ? "linear-gradient(135deg,rgba(34,197,94,0.28),rgba(22,163,74,0.12))"
                      : failed
                      ? "linear-gradient(135deg,rgba(248,113,113,0.25),rgba(220,38,38,0.12))"
                      : "linear-gradient(145deg,rgba(59,130,246,0.13),rgba(255,255,255,0.04))",
                    border: applied
                      ? "1px solid rgba(74,222,128,0.45)"
                      : failed
                      ? "1px solid rgba(248,113,113,0.45)"
                      : "1px solid rgba(99,179,255,0.18)",
                    boxShadow: applied ? "0 6px 20px rgba(34,197,94,0.18)" : "0 4px 16px rgba(0,0,0,0.18)",
                  }}>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:12,fontWeight:600,
                        color: applied ? C.green : failed ? C.red : C.text,
                        whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis" }}>
                        {applied ? "تم التفعيل" : failed ? "غير متصل!" : mode.name}
                      </div>
                      <div style={{ ...MONO,fontSize:8,color:C.textMute,marginTop:4 }}>
                        {commands} أوامر
                      </div>
                    </div>
                    <div style={{
                      width:38,height:38,borderRadius:12,flexShrink:0,fontSize:20,
                      display:"flex",alignItems:"center",justifyContent:"center",
                      background: applied ? "rgba(74,222,128,0.12)" : failed ? "rgba(248,113,113,0.12)" : "rgba(59,130,246,0.12)",
                      border: applied ? "1px solid rgba(74,222,128,0.20)" : failed ? "1px solid rgba(248,113,113,0.20)" : "1px solid rgba(99,179,255,0.12)",
                    }}>
                      {applied ? "✓" : failed ? "✕" : mode.icon}
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
                    background:d.id===dev!.id ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "transparent",
                    border:d.id===dev!.id ? "1px solid rgba(99,179,255,0.45)" : "1px solid transparent",
                    color:d.id===dev!.id ? "#fff" : C.textDim,
                    boxShadow:d.id===dev!.id ? "0 4px 14px rgba(37,99,235,0.35)" : "none",
                  }}>{d.name}</button>
                ))}
              </div>

              <div key={dev!.id} style={{
                display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,
                alignContent:"start",marginTop:10,animation:"dropIn 0.2s ease",
              }}>
                {dev!.buttons.map((btn, i) =>
                  btn.enabled ? (
                    <DeviceCard
                      key={i}
                      btn={btn}
                      isPending={pendingKey === `${dev!.id}-${i}`}
                      onToggle={() => toggleButton(dev!.id, i)}
                    />
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
        </>
      )}
    </div>
  );
}

function DeviceCard({ btn, isPending, onToggle }:{ btn:ButtonCfg; isPending:boolean; onToggle:()=>void }) {
  const { icon, label, on } = btn;
  return (
    <button onClick={onToggle} disabled={isPending} style={{
      height:126,borderRadius:18,padding:"15px 15px 13px",
      display:"flex",flexDirection:"column",justifyContent:"space-between",
      textAlign:"right",direction:"rtl",cursor: isPending ? "wait" : "pointer",
      opacity: isPending ? 0.75 : 1,
      background: on
        ? "linear-gradient(140deg,rgba(59,130,246,0.22),rgba(37,99,235,0.10))"
        : "rgba(255,255,255,0.05)",
      border: on ? "1px solid rgba(99,179,255,0.42)" : "1px solid rgba(255,255,255,0.09)",
      boxShadow: on
        ? "0 0 28px rgba(59,130,246,0.22),0 8px 24px rgba(0,0,0,0.35)"
        : "0 4px 18px rgba(0,0,0,0.28)",
      transition:"all 0.2s ease",
    }}>
      <div style={{ display:"flex",alignItems:"flex-start",justifyContent:"space-between" }}>
        <ToggleSwitch on={on} />
        <span style={{
          fontSize:26,lineHeight:1,
          filter: on ? "drop-shadow(0 0 10px rgba(96,165,250,0.75))" : "grayscale(0.6) opacity(0.45)",
          transition:"filter 0.25s",
        }}>{icon}</span>
      </div>
      <div>
        <div style={{ fontSize:13,fontWeight:600,lineHeight:1.3,
          color: on ? C.text : "rgba(255,255,255,0.42)" }}>{label}</div>
        <div style={{ ...MONO,fontSize:10,marginTop:3,
          color: on ? C.cyan : "rgba(255,255,255,0.18)",fontWeight:500 }}>
          {isPending ? "⏳ ..." : on ? "● ACTIVE" : "○ OFF"}
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
      transition:"all 0.2s",
    }}>
      <div style={{
        position:"absolute",top:3,left: on ? 19 : 3,
        width:14,height:14,borderRadius:"50%",
        background: on ? "#fff" : "rgba(255,255,255,0.5)",
        transition:"left 0.2s",
      }} />
    </div>
  );
}

/* ══════════════════════════════════════════════
   SETTINGS PAGE
══════════════════════════════════════════════ */

type SettingsTab = "devices" | "buttons" | "modes" | "remote";

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

  // حالات إضافة جهاز جديد (فارغة افتراضياً وتلزم المستخدم بالإدخال)
  const [showAddForm, setShowAddForm]     = useState(false);
  const [selectedType, setSelectedType]   = useState<DeviceTypeKey | "">("");
  const [newDeviceName, setNewDeviceName] = useState("");
  const [newDeviceIp, setNewDeviceIp]     = useState("");
  const [formError, setFormError]         = useState<string | null>(null);

  // حالات برمجة الريموت
  const [remoteProgIndex, setRemoteProgIndex]   = useState<number | null>(null);
  const [remoteProgStatus, setRemoteProgStatus] = useState<Record<number, "idle" | "waiting" | "done" | "error">>({});

  const dev = devices.find(d=>d.id===activeId) ?? devices[0];

  const saveFlash = () => { setSaved(true); setTimeout(()=>setSaved(false),2000); };

  const updateDev = (id:string, patch:Partial<Device>) =>
    updateDevices(ds => ds.map(d => d.id===id ? {...d,...patch} : d));

  const updateDevWifi = (id: string, wifiPatch: Partial<DeviceWifiSettings>) =>
    updateDevices(ds => ds.map(d =>
      d.id !== id ? d :
      { ...d, wifiSettings: { ...(d.wifiSettings ?? makeDefaultWifiSettings()), ...wifiPatch } }
    ));

  // إرسال إعدادات الواي فاي والشبكة الافتراضية والتفضيل للبوردة
  const sendWifiConfigToDevice = async (device: Device): Promise<boolean> => {
    const ws = device.wifiSettings ?? makeDefaultWifiSettings();
    const cleanIp = device.ip.trim();
    if (!cleanIp) return false;

    const params = new URLSearchParams({
      homeSsid: ws.homeSsid,
      homePass: ws.homePass,
      apSsid:   ws.apSsid,
      apPass:   ws.apPass,
      prefer:   ws.preferMode,
    });

    try {
      const res = await fetchWithTimeout(`http://${cleanIp}/wifi_config?${params.toString()}`, 2500);
      return res.ok;
    } catch {
      return false;
    }
  };

  // إلزام المستخدم بإدخال كافة بيانات الجهاز قبل الإضافة
  const confirmAddDevice = () => {
    if (!selectedType) {
      setFormError("⚠️ يرجى اختيار نوع الجهاز من القائمة أولاً.");
      return;
    }
    if (!newDeviceName.trim()) {
      setFormError("⚠️ يرجى إدخال اسم المكان / الغرفة.");
      return;
    }
    if (!newDeviceIp.trim()) {
      setFormError("⚠️ يرجى إدخال عنوان الـ IP الخاص بالجهاز.");
      return;
    }

    setFormError(null);
    const d:Device = {
      id: mkId(),
      name: newDeviceName.trim(),
      type: selectedType,
      ip: newDeviceIp.trim(),
      buttons: makeDefaultButtons(),
      wifiSettings: makeDefaultWifiSettings(),
      rfLearned: [true, true, true, true, true, true, true],
    };
    updateDevices(ds => [...ds, d]);
    setActiveId(d.id);
    setShowAddForm(false);
    setSelectedType("");
    setNewDeviceName("");
    setNewDeviceIp("");
  };

  // حذف جهاز مع رسالة تأكيد
  const removeDevice = (id:string) => {
    const target = devices.find(d => d.id === id);
    const confirmed = window.confirm(`⚠️ هل أنت متأكد من حذف الجهاز "${target?.name ?? ""}"؟`);
    if (!confirmed) return;

    updateDevices(ds => ds.filter(d => d.id !== id));
    setModes(ms => ms.map(m => ({
      ...m,
      steps: m.steps.filter(s => s.deviceId !== id),
    })));
  };

  const updateBtn = (btnIdx:number, patch:Partial<ButtonCfg>) =>
    updateDevices(ds => ds.map(d =>
      d.id!==activeId ? d :
      { ...d, buttons: d.buttons.map((b,i)=> i===btnIdx ? {...b,...patch} : b) }
    ));

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

  // حذف وضع ذكي مع رسالة تأكيد
  const removeMode = (id:string) => {
    const target = modes.find(m => m.id === id);
    const confirmed = window.confirm(`⚠️ هل أنت متأكد من حذف الوضع الذكي "${target?.name ?? ""}"؟`);
    if (!confirmed) return;
    setModes(ms=>ms.filter(mode=>mode.id!==id));
  };

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

  // استقبال وحفظ كود الريموت
  const receiveRemoteCode = async (btnIdx: number) => {
    if (!dev?.ip) return;
    setRemoteProgIndex(btnIdx);
    setRemoteProgStatus(prev => ({ ...prev, [btnIdx]: "waiting" }));

    try {
      const ch = btnIdx + 1;
      const cleanIp = dev.ip.trim();
      const res = await fetchWithTimeout(`http://${cleanIp}/learn_rf?ch=${ch}`, 9000);
      if (res.ok) {
        setRemoteProgStatus(prev => ({ ...prev, [btnIdx]: "done" }));
        updateDevices(ds => ds.map(d => {
          if (d.id !== dev.id) return d;
          const arr = [...(d.rfLearned ?? [false,false,false,false,false,false,false])];
          arr[btnIdx] = true;
          return { ...d, rfLearned: arr };
        }));
      } else {
        setRemoteProgStatus(prev => ({ ...prev, [btnIdx]: "error" }));
      }
    } catch {
      setRemoteProgStatus(prev => ({ ...prev, [btnIdx]: "error" }));
    } finally {
      setRemoteProgIndex(null);
      setTimeout(() => {
        setRemoteProgStatus(prev => ({ ...prev, [btnIdx]: "idle" }));
      }, 3000);
    }
  };

  // حذف كود الريموت مع رسالة تنبيه
  const deleteRemoteCode = async (btnIdx: number) => {
    if (!dev?.ip) return;
    const btnName = dev.buttons[btnIdx]?.label ?? `زر ${btnIdx + 1}`;
    const confirmed = window.confirm(`⚠️ تنبيه: هل أنت متأكد من حذف كود الريموت الخاص بـ "${btnName}" (خط ${btnIdx + 1})؟`);
    if (!confirmed) return;

    try {
      const ch = btnIdx + 1;
      const cleanIp = dev.ip.trim();
      const res = await fetchWithTimeout(`http://${cleanIp}/clear_rf?ch=${ch}`, 2000);
      if (res.ok) {
        updateDevices(ds => ds.map(d => {
          if (d.id !== dev.id) return d;
          const arr = [...(d.rfLearned ?? [false,false,false,false,false,false,false])];
          arr[btnIdx] = false;
          return { ...d, rfLearned: arr };
        }));
        alert("✓ تم حذف كود الريموت من الجهاز بنجاح.");
      } else {
        alert("✕ تعذر حذف الكود، تأكد من اتصال الجهاز.");
      }
    } catch {
      alert("✕ تعذر الاتصال بالجهاز لحذف الكود.");
    }
  };

  const SectionHead = ({ico,txt}:{ico:string;txt:string}) => (
    <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
      <span>{ico}</span>
      <span style={{ fontSize:11,fontWeight:600,color:C.textDim,
        letterSpacing:"0.10em",textTransform:"uppercase" }}>{txt}</span>
      <div style={{ flex:1,height:1,background:"rgba(255,255,255,0.08)" }} />
    </div>
  );

  const EmptyDeviceNotice = () => (
    <div style={{
      padding:"20px 16px", borderRadius:18, textAlign:"center",
      background:"rgba(59,130,246,0.07)",
      border:"1px dashed rgba(99,179,255,0.25)",
      color:C.textDim, fontSize:13, lineHeight:1.7,
    }}>
      لا توجد أجهزة مضافة حالياً. انتقل إلى تبويب «📡 الأجهزة» لإضافة جهاز أولاً.
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
            <div style={{ fontSize:13,color:C.textMute,marginTop:2 }}>إدارة الأجهزة والأزرار والريموت</div>
          </div>
        </div>

        {/* tabs */}
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:5,
          background:"rgba(255,255,255,0.05)",
          border:`1px solid ${C.border}`,
          borderRadius:14,padding:4 }}>
          {([
            ["devices","📡 الأجهزة"],
            ["buttons","🎛️ الأزرار"],
            ["modes","✨ الأوضاع"],
            ["remote","📻 الريموت كنترول"],
          ] as const).map(([t,label])=>(
            <button key={t} onClick={()=>setTab(t)} style={{
              padding:"9px 4px",borderRadius:11,cursor:"pointer",
              fontSize:11,fontWeight:600,transition:"all 0.2s",
              whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",
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

            {devices.length === 0 && !showAddForm && (
              <div style={{
                padding:"18px 16px", borderRadius:18, textAlign:"center",
                background:"rgba(59,130,246,0.07)",
                border:"1px dashed rgba(99,179,255,0.25)",
                color:C.textDim, fontSize:13, lineHeight:1.7,
              }}>
                القائمة فارغة حالياً. اضغط بالأسفل لإضافة جهاز جديد.
              </div>
            )}

            {devices.map(d => (
              <DeviceSettingCard key={d.id} device={d}
                active={d.id===dev?.id}
                onSelect={()=>{ setActiveId(d.id); setTab("buttons"); }}
                onNameChange={v=>updateDev(d.id,{name:v})}
                onIpChange={v=>updateDev(d.id,{ip:v})}
                onWifiChange={patch=>updateDevWifi(d.id, patch)}
                onApplyWifi={() => sendWifiConfigToDevice(d)}
                onRemove={()=>removeDevice(d.id)}
              />
            ))}

            {/* نموذج إضافة جهاز جديد (خانة وصفية تلزم بالإدخال الكامل) */}
            {showAddForm ? (
              <div style={{
                borderRadius:18, padding:16,
                background:"rgba(59,130,246,0.10)",
                border:"1px solid rgba(99,179,255,0.35)",
                display:"flex", flexDirection:"column", gap:12,
                animation:"dropIn 0.2s ease",
              }}>
                <div style={{ fontSize:13, fontWeight:700, color:C.cyan }}>
                  إضافة جهاز جديد
                </div>

                {formError && (
                  <div style={{
                    padding:"9px 12px", borderRadius:10,
                    background:"rgba(248,113,113,0.15)",
                    border:"1px solid rgba(248,113,113,0.35)",
                    color:C.red, fontSize:12,
                  }}>
                    {formError}
                  </div>
                )}

                <div>
                  <div style={{ fontSize:11, color:C.textMute, marginBottom:6 }}>نوع الجهاز *</div>
                  <select
                    value={selectedType}
                    onChange={e => { setSelectedType(e.target.value as DeviceTypeKey); setFormError(null); }}
                    style={{
                      ...inputBase, width:"100%", padding:"10px 12px", fontSize:13,
                      cursor:"pointer", background:"#0e1d45",
                      color: selectedType ? C.text : C.textMute,
                    }}
                  >
                    <option value="" disabled>اختر نوع الجهاز...</option>
                    {DEVICE_TYPES.map(dt => (
                      <option key={dt.key} value={dt.key} style={{ color:C.text }}>{dt.label}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
                  <div>
                    <div style={{ fontSize:11, color:C.textMute, marginBottom:6 }}>اسم المكان *</div>
                    <input
                      value={newDeviceName}
                      onChange={e => { setNewDeviceName(e.target.value); setFormError(null); }}
                      placeholder="أدخل اسم المكان (مثال: الصالة)"
                      style={{ ...inputBase, width:"100%", padding:"9px 12px", fontSize:13 }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:C.textMute, marginBottom:6 }}>عنوان IP *</div>
                    <input
                      value={newDeviceIp}
                      onChange={e => { setNewDeviceIp(e.target.value); setFormError(null); }}
                      placeholder="أدخل عنوان IP (192.168.8.200)"
                      style={{ ...inputBase, ...MONO, width:"100%", padding:"9px 12px", fontSize:12 }}
                    />
                  </div>
                </div>

                <div style={{ display:"flex", gap:8, marginTop:4 }}>
                  <button onClick={confirmAddDevice} style={{
                    flex:1, padding:"11px 14px", borderRadius:12, cursor:"pointer",
                    fontSize:13, fontWeight:700, border:"none", color:"#fff",
                    background:"linear-gradient(135deg,#3b82f6,#2563eb)",
                  }}>
                    ✓ تأكيد الإضافة
                  </button>
                  <button onClick={() => { setShowAddForm(false); setFormError(null); }} style={{
                    padding:"11px 14px", borderRadius:12, cursor:"pointer",
                    fontSize:13, color:C.textDim,
                    background:"rgba(255,255,255,0.06)",
                    border:`1px solid ${C.border}`,
                  }}>
                    إلغاء
                  </button>
                </div>
              </div>
            ) : (
              <button onClick={() => { setShowAddForm(true); setFormError(null); }} style={{
                width:"100%",padding:14,borderRadius:16,cursor:"pointer",
                fontSize:14,fontWeight:600,
                background:"rgba(59,130,246,0.10)",
                border:"1.5px dashed rgba(99,179,255,0.30)",
                color:C.cyan,display:"flex",alignItems:"center",justifyContent:"center",gap:8,
              }}>
                <span style={{ fontSize:18 }}>＋</span> إضافة جهاز جديد
              </button>
            )}
          </>
        ) : tab==="buttons" ? (
          devices.length === 0 ? <EmptyDeviceNotice /> : (
            <>
              <div>
                <SectionHead ico="🏠" txt="اختر الجهاز" />
                <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:4 }}>
                  {devices.map(d=>(
                    <button key={d.id} onClick={()=>setActiveId(d.id)} style={{
                      padding:"7px 16px",borderRadius:20,cursor:"pointer",whiteSpace:"nowrap",
                      fontSize:13,fontWeight:600,transition:"all 0.2s",
                      background: d.id===dev!.id ? "linear-gradient(135deg,#3b82f6,#2563eb)" : C.surface,
                      border: d.id===dev!.id ? "1px solid rgba(99,179,255,0.5)" : `1px solid ${C.border}`,
                      color: d.id===dev!.id ? "#fff" : C.textDim,
                    }}>{d.name}</button>
                  ))}
                </div>
              </div>

              <div>
                <SectionHead ico="🎛️" txt={`أزرار ${dev!.name}`} />
                <div style={{ background:C.surface,border:`1px solid ${C.border}`,
                  borderRadius:20,overflow:"hidden" }}>
                  {dev!.buttons.map((btn,i)=>(
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
          )
        ) : tab==="modes" ? (
          devices.length === 0 ? <EmptyDeviceNotice /> : (
            <>
              <div>
                <SectionHead ico="✨" txt="برمجة الأوضاع الذكية" />
                <div style={{
                  padding:"12px 14px",borderRadius:15,marginBottom:14,
                  background:"rgba(59,130,246,0.08)",
                  border:"1px solid rgba(99,179,255,0.16)",
                  fontSize:12,lineHeight:1.7,color:C.textDim,
                }}>
                  يتم تنفيذ الأوامر بالترتيب من الأعلى للأسفل. يمكنك اختيار تشغيل أو إيقاف أو تبديل حالة كل زر.
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
          )
        ) : (
          /* ── تبويب الريموت كنترول ── */
          devices.length === 0 ? <EmptyDeviceNotice /> : (
            <>
              <div>
                <SectionHead ico="🏠" txt="اختر الجهاز" />
                <div style={{ display:"flex",gap:8,overflowX:"auto",paddingBottom:4 }}>
                  {devices.map(d=>(
                    <button key={d.id} onClick={()=>setActiveId(d.id)} style={{
                      padding:"7px 16px",borderRadius:20,cursor:"pointer",whiteSpace:"nowrap",
                      fontSize:13,fontWeight:600,transition:"all 0.2s",
                      background: d.id===dev!.id ? "linear-gradient(135deg,#3b82f6,#2563eb)" : C.surface,
                      border: d.id===dev!.id ? "1px solid rgba(99,179,255,0.5)" : `1px solid ${C.border}`,
                      color: d.id===dev!.id ? "#fff" : C.textDim,
                    }}>{d.name}</button>
                  ))}
                </div>
              </div>

              <div>
                <SectionHead ico="📻" txt={`برمجة أزرار الريموت · ${dev!.name}`} />
                <div style={{
                  padding:"12px 14px",borderRadius:15,marginBottom:14,
                  background:"rgba(59,130,246,0.08)",
                  border:"1px solid rgba(99,179,255,0.16)",
                  fontSize:12,lineHeight:1.7,color:C.textDim,
                }}>
                  اضغط «استقبال الكود» ثم اضغط على الزر المطلوب في ريموت الـ RF خلال 8 ثوانٍ لحفظه، أو اضغط «حذف الكود» لإلغائه.
                </div>

                <div style={{
                  background:C.surface,
                  border:`1px solid ${C.border}`,
                  borderRadius:20,
                  overflow:"hidden",
                }}>
                  {dev!.buttons.map((btn, i) => {
                    const status = remoteProgStatus[i] ?? "idle";
                    const isWaiting = remoteProgIndex === i || status === "waiting";
                    return (
                      <div key={i} style={{
                        display:"flex", alignItems:"center", gap:10,
                        padding:"14px 14px",
                        borderBottom: i === 6 ? "none" : "1px solid rgba(255,255,255,0.06)",
                      }}>
                        <div style={{
                          width:38, height:38, borderRadius:11, fontSize:19, flexShrink:0,
                          background:"rgba(59,130,246,0.10)",
                          border:"1px solid rgba(99,179,255,0.18)",
                          display:"flex", alignItems:"center", justifyContent:"center",
                        }}>
                          {btn.icon}
                        </div>

                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                            <span style={{ ...MONO, fontSize:9, color:C.textMute }}>
                              خط {i + 1}
                            </span>
                            <span style={{
                              fontSize:9, fontWeight:600, padding:"1px 6px", borderRadius:6,
                              background: btn.enabled ? "rgba(74,222,128,0.12)" : "rgba(255,255,255,0.06)",
                              color: btn.enabled ? C.green : C.textMute,
                            }}>
                              {btn.enabled ? "ظاهر" : "مخفي"}
                            </span>
                          </div>
                          <div style={{
                            fontSize:13, fontWeight:600, color:C.text,
                            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
                          }}>
                            {btn.label}
                          </div>
                        </div>

                        <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                          <button
                            onClick={() => receiveRemoteCode(i)}
                            disabled={remoteProgIndex !== null}
                            style={{
                              padding:"8px 11px",
                              borderRadius:10,
                              cursor: remoteProgIndex !== null ? "wait" : "pointer",
                              fontSize:11,
                              fontWeight:600,
                              transition:"all 0.2s",
                              border: status === "done"
                                ? "1px solid rgba(74,222,128,0.45)"
                                : status === "error"
                                ? "1px solid rgba(248,113,113,0.45)"
                                : "1px solid rgba(99,179,255,0.35)",
                              background: status === "done"
                                ? "linear-gradient(135deg,rgba(34,197,94,0.28),rgba(22,163,74,0.15))"
                                : status === "error"
                                ? "linear-gradient(135deg,rgba(248,113,113,0.25),rgba(220,38,38,0.12))"
                                : "linear-gradient(135deg,#3b82f6,#2563eb)",
                              color: status === "done" ? C.green : status === "error" ? C.red : "#fff",
                            }}
                          >
                            {isWaiting
                              ? "⏳ انتظر..."
                              : status === "done"
                              ? "✓ تم حفظ الكود"
                              : status === "error"
                              ? "✕ فشل الاستقبال"
                              : "استقبال الكود"}
                          </button>

                          <button
                            onClick={() => deleteRemoteCode(i)}
                            disabled={remoteProgIndex !== null}
                            title="حذف الكود"
                            style={{
                              padding:"8px 10px",
                              borderRadius:10,
                              cursor:"pointer",
                              fontSize:11,
                              fontWeight:600,
                              background:"rgba(248,113,113,0.12)",
                              border:"1px solid rgba(248,113,113,0.28)",
                              color:C.red,
                            }}
                          >
                            حذف الكود
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )
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

/* ── Device card in settings (WITH EXPANDABLE DEVICE SETTINGS) ── */
function DeviceSettingCard({ device,active,onSelect,onNameChange,onIpChange,onWifiChange,onApplyWifi,onRemove }:{
  device:Device; active:boolean;
  onSelect:()=>void; onNameChange:(v:string)=>void; onIpChange:(v:string)=>void;
  onWifiChange:(patch:Partial<DeviceWifiSettings>)=>void;
  onApplyWifi:()=>Promise<boolean>;
  onRemove:()=>void;
}) {
  const [expandedWifi, setExpandedWifi] = useState(false);
  const [wifiSendState, setWifiSendState] = useState<"idle" | "sending" | "ok" | "fail">("idle");

  const enabledCount = device.buttons.filter(b=>b.enabled).length;
  const typeLabel = DEVICE_TYPES.find(t => t.key === device.type)?.label ?? "سمارت هوم 7 خطوط";
  const ws = device.wifiSettings ?? makeDefaultWifiSettings();

  const handleSaveWifiToBoard = async () => {
    setWifiSendState("sending");
    const ok = await onApplyWifi();
    setWifiSendState(ok ? "ok" : "fail");
    setTimeout(() => setWifiSendState("idle"), 3000);
  };

  return (
    <div style={{
      borderRadius:18, overflow:"hidden",
      background: active ? "rgba(59,130,246,0.10)" : C.surface,
      border: active ? "1px solid rgba(99,179,255,0.35)" : `1px solid ${C.border}`,
      transition:"all 0.2s",
    }}>
      {/* top bar */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"14px 16px 10px", gap:6, flexWrap:"wrap" }}>
        <div style={{ display:"flex",alignItems:"center",gap:8 }}>
          <div style={{ width:8,height:8,borderRadius:"50%",
            background: active ? C.green : "rgba(255,255,255,0.2)",
            boxShadow: active ? `0 0 8px rgba(74,222,128,0.6)` : "none",
            animation: active ? "pulse 2s ease-in-out infinite" : "none" }} />
          <span style={{ fontSize:12,fontWeight:600,color: active ? C.cyan : C.textDim }}>
            {typeLabel}
          </span>
          <span style={{ ...MONO,fontSize:10,color:C.textMute }}>
            · {enabledCount} أزرار
          </span>
        </div>

        <div style={{ display:"flex",gap:6 }}>
          <button onClick={() => setExpandedWifi(v => !v)} style={{
            padding:"5px 10px",borderRadius:8,cursor:"pointer",
            fontSize:11,fontWeight:600,
            background: expandedWifi ? "rgba(96,165,250,0.28)" : "rgba(255,255,255,0.07)",
            border:"1px solid rgba(99,179,255,0.30)",
            color:C.text,
          }}>
            ⚙️ إعدادات الجهاز {expandedWifi ? "▲" : "▼"}
          </button>

          <button onClick={onSelect} style={{
            padding:"5px 10px",borderRadius:8,cursor:"pointer",
            fontSize:11,fontWeight:600,
            background:"rgba(59,130,246,0.15)",
            border:"1px solid rgba(99,179,255,0.30)",
            color:C.cyan,
          }}>الأزرار</button>

          <button onClick={onRemove} style={{
            width:28,height:28,borderRadius:8,cursor:"pointer",
            background:"rgba(248,113,113,0.10)",
            border:"1px solid rgba(248,113,113,0.25)",
            color:C.red,fontSize:13,
            display:"flex",alignItems:"center",justifyContent:"center",
          }}>✕</button>
        </div>
      </div>

      {/* basic inputs */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,padding:"0 16px 16px" }}>
        <div>
          <div style={{ fontSize:11,color:C.textMute,marginBottom:6 }}>اسم الجهاز</div>
          <input value={device.name} onChange={e=>onNameChange(e.target.value)}
            placeholder="مثال: الصالة"
            style={{ ...inputBase,width:"100%",padding:"9px 12px",fontSize:13 }}
          />
        </div>
        <div>
          <div style={{ fontSize:11,color:C.textMute,marginBottom:6 }}>عنوان IP</div>
          <input value={device.ip} onChange={e=>onIpChange(e.target.value)}
            placeholder="192.168.8.200"
            style={{ ...inputBase,...MONO,width:"100%",padding:"9px 12px",fontSize:12,letterSpacing:"0.05em" }}
          />
        </div>
      </div>

      {/* القائمة الموسعة: إعدادات شبكة المنزل والشبكة الافتراضية والتفضيل */}
      {expandedWifi && (
        <div style={{
          borderTop:"1px solid rgba(255,255,255,0.08)",
          background:"rgba(3,10,30,0.38)",
          padding:"14px 16px 16px",
          display:"flex", flexDirection:"column", gap:12,
          animation:"dropIn 0.2s ease",
        }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.cyan }}>
            📶 إعدادات شبكة واي فاي المنزل
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <div style={{ fontSize:10, color:C.textMute, marginBottom:5 }}>اسم شبكة المنزل (SSID)</div>
              <input
                value={ws.homeSsid}
                onChange={e => onWifiChange({ homeSsid: e.target.value })}
                placeholder="اسم واي فاي المنزل"
                style={{ ...inputBase, width:"100%", padding:"8px 11px", fontSize:12 }}
              />
            </div>
            <div>
              <div style={{ fontSize:10, color:C.textMute, marginBottom:5 }}>كلمة سر شبكة المنزل</div>
              <input
                value={ws.homePass}
                onChange={e => onWifiChange({ homePass: e.target.value })}
                placeholder="باسورد واي فاي المنزل"
                style={{ ...inputBase, width:"100%", padding:"8px 11px", fontSize:12 }}
              />
            </div>
          </div>

          <div style={{ fontSize:12, fontWeight:700, color:C.cyan, marginTop:4 }}>
            📡 إعدادات الشبكة الافتراضية للجهاز (AP)
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <div>
              <div style={{ fontSize:10, color:C.textMute, marginBottom:5 }}>اسم الشبكة الافتراضية</div>
              <input
                value={ws.apSsid}
                onChange={e => onWifiChange({ apSsid: e.target.value })}
                placeholder="smart"
                style={{ ...inputBase, width:"100%", padding:"8px 11px", fontSize:12 }}
              />
            </div>
            <div>
              <div style={{ fontSize:10, color:C.textMute, marginBottom:5 }}>كلمة سر الشبكة الافتراضية</div>
              <input
                value={ws.apPass}
                onChange={e => onWifiChange({ apPass: e.target.value })}
                placeholder="smart2020"
                style={{ ...inputBase, width:"100%", padding:"8px 11px", fontSize:12 }}
              />
            </div>
          </div>

          <div>
            <div style={{ fontSize:11, color:C.textMute, marginBottom:6 }}>تفضيل الاتصال للشبكة</div>
            <select
              value={ws.preferMode}
              onChange={e => onWifiChange({ preferMode: e.target.value as WifiPreferMode })}
              style={{
                ...inputBase, width:"100%", padding:"9px 12px", fontSize:12,
                cursor:"pointer", background:"#0e1d45",
              }}
            >
              <option value="home">تفضيل شبكة المنزل (مع تفعيل الشبكة الافتراضية عند الانقطاع)</option>
              <option value="ap">تفضيل الشبكة الافتراضية فقط (عدم الاتصال بشبكة المنزل)</option>
            </select>
          </div>

          <button
            onClick={handleSaveWifiToBoard}
            disabled={wifiSendState === "sending"}
            style={{
              width:"100%", padding:"10px 14px", borderRadius:12, cursor:"pointer",
              fontSize:12, fontWeight:700, border:"none", color:"#fff", marginTop:2,
              background: wifiSendState === "ok"
                ? "linear-gradient(135deg,#22c55e,#16a34a)"
                : wifiSendState === "fail"
                ? "linear-gradient(135deg,#ef4444,#dc2626)"
                : "linear-gradient(135deg,#3b82f6,#2563eb)",
            }}
          >
            {wifiSendState === "sending"
              ? "⏳ جاري إرسال الإعدادات للجهاز..."
              : wifiSendState === "ok"
              ? "✓ تم إرسال وحفظ إعدادات الشبكة في الجهاز"
              : wifiSendState === "fail"
              ? "✕ تعذر الإرسال · تأكد من الاتصال بالجهاز"
              : "📤 حفظ وإرسال إعدادات الشبكة للجهاز"}
          </button>
        </div>
      )}
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
            animation:"dropIn 0.18s ease",minWidth:204,maxHeight:240,overflowY:"auto",
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

/* ── Smart mode card in settings (SEQUENTIAL + TOGGLE OPTION) ── */
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
            ...inputBase,width:56,height:42,padding:"0 8px",fontSize:19,cursor:"pointer",
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
                          ...inputBase,width:110,padding:"6px 8px",fontSize:10,cursor:"pointer",
                          color:action==="on" ? C.green : action==="off" ? C.red : action==="toggle" ? C.amber : C.textMute,
                        }}>
                        <option value="skip">بدون تغيير</option>
                        <option value="on">تشغيل</option>
                        <option value="off">إيقاف</option>
                        <option value="toggle">تبديل الحالة</option>
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
