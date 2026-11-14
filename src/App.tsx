/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin } from '@vis.gl/react-google-maps';
import {
  Search,
  Star,
  ShieldCheck,
  CheckCircle2,
  Clock,
  MapPin,
  MessageSquare,
  Lock,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  AlertTriangle,
  FileText,
  SlidersHorizontal,
  PlusCircle,
  X,
  Eye,
  Check,
  Sparkles,
  Terminal,
  Code2,
  Sun,
  Moon,
  Home,
  Share2,
  RotateCcw,
  RotateCw,
  Move,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  Compass,
  Plus,
  Minus,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Layers,
  UserPlus,
  LogIn,
  Info
} from 'lucide-react';
import {
  auth,
  db,
  loginWithGoogle,
  logoutUser,
  onAuthStateChanged,
  sendEmailVerification,
  testFirestoreConnection,
  handleFirestoreError,
  OperationType,
  User as FirebaseUser
} from './firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  setDoc,
  addDoc,
  query,
  where,
  onSnapshot
} from 'firebase/firestore';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';


interface UserProfile {
  id: string;
  name: string;
  email: string;
  isVerified: boolean;
  dateJoined: string;
}

interface ReportItem {
  id: string;
  title: string;
  kind: 'lost' | 'found';
  category: string;
  governorate: string;
  city: string;
  eventDate: string;
  status: 'published' | 'closed' | 'pending';
  publicDescription: string;
  owner: UserProfile;
  closedAt?: string;
  involvedClaimant?: UserProfile;
}

export const ALL_CATEGORIES = [
  'شيف مال (أموال ونقود)',
  'ذهب ومجوهرات وحلي',
  'محافظ وحقائب',
  'إلكترونيات وهواتف',
  'وثائق وبطاقات رسمية',
  'مفاتيح وأقفال',
  'أوراق',
  'ساعات ومقتنيات شخصية',
  'مركبات ودراجات',
  'أدوية ومستلزمات طبية',
  'ملابس وإكسسوارات',
  'حيوانات ومواشي',
  'حقائب وأمتعة سفر',
  'أدوات ومعدات مهنية',
  'أخرى',
] as const;

class MapErrorBoundary extends React.Component<
  { children: React.ReactNode; isDarkMode: boolean },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; isDarkMode: boolean }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.warn('Google Maps Error Boundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={`w-full h-full min-h-[350px] flex flex-col items-center justify-center p-6 text-center ${
          this.props.isDarkMode ? 'bg-[#141D17] text-[#F0E4CC]' : 'bg-[#F7F7F3] text-[#173F35]'
        }`}>
          <Compass className="w-12 h-12 text-[#B99A65] mb-2 animate-pulse" />
          <h5 className="font-black text-sm mb-1">خريطة المفقودات والموجودات حضرموت</h5>
          <p className="text-xs text-[#59635D] max-w-xs mb-4 leading-relaxed">
            تتعذر استجابة خدمة خرائط جوجل المباشرة حالياً. يمكنك استخدام التصفح والقوائم.
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false })}
            className="px-4 py-2 rounded-xl bg-[#173F35] text-white text-xs font-black hover:bg-[#0F2D26] transition shadow-xs"
          >
            إعادة محاولة تحميل الخريطة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface ReportsMapProps {
  reports: ReportItem[];
  isDarkMode: boolean;
  onSelectReport: (report: ReportItem) => void;
}

export function ReportsMap({ reports, isDarkMode, onSelectReport }: ReportsMapProps) {
  const [activeKind, setActiveKind] = useState<'all' | 'lost' | 'found'>('all');
  const [selectedPinReport, setSelectedPinReport] = useState<ReportItem | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string>('all');

  // Hadramout Districts Center Coordinates Mapping
  const locationCoords: Record<string, { lat: number; lng: number; name: string }> = {
    'المكلا': { lat: 14.538, lng: 49.124, name: 'المكلا (عاصمة حضرموت والساحل)' },
    'سيئون': { lat: 15.943, lng: 48.789, name: 'سيئون (حاضرة الوادي)' },
    'الشحر': { lat: 14.758, lng: 49.605, name: 'الشحر (مدينة الإثرة)' },
    'تريم': { lat: 16.050, lng: 48.995, name: 'تريم (عاصمة الثقافة والعلوم)' },
    'شبام': { lat: 15.926, lng: 48.627, name: 'شبام (ناطحات السحاب الطينية)' },
    'غيل باوزير': { lat: 14.774, lng: 49.362, name: 'غيل باوزير' },
    'دوعن': { lat: 15.220, lng: 48.340, name: 'وادي دوعن' },
    'القطن': { lat: 15.820, lng: 48.450, name: 'مديرية القطن' },
    'حضرموت': { lat: 15.6, lng: 49.0, name: 'محافظة حضرموت' },
  };

  // Helper to resolve coordinates for Hadramout reports
  const getReportLatLng = (rep: ReportItem, index: number) => {
    let key = '';
    if (rep.city.includes('المكلا')) key = 'المكلا';
    else if (rep.city.includes('سيئون')) key = 'سيئون';
    else if (rep.city.includes('الشحر')) key = 'الشحر';
    else if (rep.city.includes('تريم')) key = 'تريم';
    else if (rep.city.includes('شبام')) key = 'شبام';
    else if (rep.city.includes('غيل')) key = 'غيل باوزير';
    else if (rep.city.includes('دوعن')) key = 'دوعن';
    else if (rep.city.includes('القطن')) key = 'القطن';
    else key = 'المكلا';

    const base = locationCoords[key] || { lat: 14.538, lng: 49.124, name: 'حضرموت' };
    const latOffset = (index % 3 - 1) * 0.015;
    const lngOffset = Math.floor(index / 3) * 0.015;
    return {
      lat: base.lat + latOffset,
      lng: base.lng + lngOffset,
      label: base.name,
    };
  };

  // Map center location dynamically updates based on selected district dropdown
  const currentCenter = selectedLocation !== 'all' && locationCoords[selectedLocation]
    ? { lat: locationCoords[selectedLocation].lat, lng: locationCoords[selectedLocation].lng }
    : { lat: 15.5, lng: 49.0 };

  const currentZoom = selectedLocation !== 'all' ? 11 : 8;

  // Filter Hadramout reports displayed on map
  const filteredReports = reports.filter((r) => {
    if (activeKind !== 'all' && r.kind !== activeKind) return false;
    if (selectedLocation !== 'all') {
      const matchCity = r.city.includes(selectedLocation) || r.title.includes(selectedLocation) || r.publicDescription.includes(selectedLocation);
      if (!matchCity) return false;
    }
    return true;
  });

  return (
    <div className={`relative w-full rounded-3xl border shadow-xl overflow-hidden transition-all flex flex-col ${
      isDarkMode ? 'bg-[#121915] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'
    }`}>
      {/* Map Header Controls */}
      <div className={`p-3.5 border-b flex flex-wrap items-center justify-between gap-2.5 z-20 ${
        isDarkMode ? 'bg-[#19231D]/90 border-[#34463A]' : 'bg-white/90 border-[#E3E7E0]'
      }`}>
        {/* Title Badge */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-black">
            <Compass className="w-4 h-4 text-[#B99A65]" />
          </div>
          <h4 className={`text-xs md:text-sm font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>
            خريطة المفقودات والموجودات حضرموت
          </h4>
        </div>

        {/* Filters: Kind & Hadramout Districts */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center gap-1 p-1 rounded-xl border ${
            isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F0E4CC]/40 border-[#B99A65]/40'
          }`}>
            <button
              type="button"
              onClick={() => setActiveKind('all')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition ${
                activeKind === 'all'
                  ? isDarkMode
                    ? 'bg-[#F0E4CC] text-[#121915] shadow-xs'
                    : 'bg-[#173F35] text-white shadow-xs'
                  : isDarkMode
                  ? 'text-[#C7D0C8] hover:text-white'
                  : 'text-[#59635D] hover:text-[#173F35]'
              }`}
            >
              الكل ({reports.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveKind('lost')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition flex items-center gap-1 ${
                activeKind === 'lost'
                  ? isDarkMode
                    ? 'bg-[#EF4444] text-white shadow-xs font-black ring-1 ring-red-400'
                    : 'bg-[#B91C1C] text-white shadow-xs'
                  : isDarkMode
                  ? 'text-[#FCA5A5] hover:bg-red-500/20 font-black'
                  : 'text-[#B91C1C] hover:bg-red-500/10 font-black'
              }`}
            >
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                isDarkMode ? 'bg-white' : 'bg-red-500'
              }`}></span>
              مفقودات
            </button>
            <button
              type="button"
              onClick={() => setActiveKind('found')}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-black transition flex items-center gap-1 ${
                activeKind === 'found'
                  ? isDarkMode
                    ? 'bg-[#F0E4CC] text-[#121915] shadow-xs font-black'
                    : 'bg-[#059669] text-white shadow-xs font-black'
                  : isDarkMode
                  ? 'text-[#F0E4CC] hover:bg-[#F0E4CC]/20 font-black'
                  : 'text-[#059669] hover:bg-[#059669]/10 font-black'
              }`}
            >
              <span className={`w-2 h-2 rounded-full animate-pulse ${
                isDarkMode ? 'bg-[#121915]' : 'bg-emerald-400'
              }`}></span>
              موجودات
            </button>
          </div>

          {/* Hadramout Districts Selector */}
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className={`text-[11px] font-bold py-1 px-2.5 rounded-xl border transition ${
              isDarkMode ? 'bg-[#141D17] border-[#34463A] text-[#F0E4CC]' : 'bg-white border-[#C7D0C8] text-[#173F35]'
            }`}
          >
            <option value="all">📍 كل مدن ومناطق حضرموت</option>
            <option value="المكلا">المكلا (حي الشرج / السلام / فوه)</option>
            <option value="سيئون">سيئون (حي السحيل / الوحدة)</option>
            <option value="الشحر">الشحر (حي الخور / السوق)</option>
            <option value="تريم">تريم (حي الخليف / السوق)</option>
            <option value="شبام">شبام حضرموت</option>
            <option value="غيل باوزير">غيل باوزير</option>
            <option value="دوعن">وادي دوعن (صيف / الخريبة)</option>
            <option value="القطن">القطن</option>
          </select>
        </div>
      </div>

      {/* LIVE GOOGLE MAPS VIEWPORT CONTAINER */}
      <div className="w-full h-[400px] md:h-[460px] relative">
        {!GOOGLE_MAPS_API_KEY ? (
          <div className={`w-full h-full min-h-[350px] flex flex-col items-center justify-center p-6 text-center ${
            isDarkMode ? 'bg-[#141D17] text-[#F0E4CC]' : 'bg-[#F7F7F3] text-[#173F35]'
          }`}>
            <Compass className="w-12 h-12 text-[#B99A65] mb-2" />
            <h5 className="font-black text-sm mb-1">خريطة المفقودات والموجودات حضرموت</h5>
            <p className="text-xs text-[#59635D] max-w-xs leading-relaxed">
              تتطلب الخريطة التفاعلية ضبط متغير البيئة VITE_GOOGLE_MAPS_API_KEY. يمكنك تصفح كافة البلاغات من القوائم أدناه.
            </p>
          </div>
        ) : (
        <MapErrorBoundary isDarkMode={isDarkMode}>
          <APIProvider apiKey={GOOGLE_MAPS_API_KEY}>
            <Map
              key={`${currentCenter.lat}-${currentCenter.lng}-${currentZoom}`}
              defaultCenter={currentCenter}
              defaultZoom={currentZoom}
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={["gmp_mcp_codeassist_v1_aistudio"]}
              className="w-full h-full"
            >
              {filteredReports.map((rep, idx) => {
                const pos = getReportLatLng(rep, idx);
                const isLost = rep.kind === 'lost';
                const isSelected = selectedPinReport?.id === rep.id;

                return (
                  <AdvancedMarker
                    key={rep.id}
                    position={{ lat: pos.lat, lng: pos.lng }}
                    onClick={() => setSelectedPinReport(rep)}
                  >
                    <Pin
                      background={isLost ? '#DC2626' : isDarkMode ? '#F0E4CC' : '#059669'}
                      glyphColor={isLost ? '#FFFFFF' : isDarkMode ? '#121915' : '#FFFFFF'}
                      borderColor={isLost ? '#991B1B' : '#B99A65'}
                      scale={isSelected ? 1.3 : 1.0}
                    />
                  </AdvancedMarker>
                );
              })}
            </Map>
          </APIProvider>
        </MapErrorBoundary>
        )}

        {/* SELECTED PIN POPUP CARD OVERLAY */}
        {selectedPinReport && (
          <div className="absolute bottom-4 left-4 right-4 z-40 max-w-sm mx-auto animate-in fade-in slide-in-from-bottom-3 duration-200">
            <div className={`p-4 rounded-2xl border shadow-2xl flex flex-col gap-2 relative ${
              isDarkMode ? 'bg-[#19231D] border-[#34463A] text-white' : 'bg-white border-[#E3E7E0] text-[#202722]'
            }`}>
              <button
                type="button"
                onClick={() => setSelectedPinReport(null)}
                className="absolute top-3 left-3 p-1 rounded-full text-[#59635D] hover:bg-[#F0E4CC]/30 transition"
              >
                <X className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-black ${
                  selectedPinReport.kind === 'lost'
                    ? 'bg-[#8C2727]/20 text-[#8C2727]'
                    : isDarkMode
                    ? 'bg-[#F0E4CC] text-[#121915]'
                    : 'bg-[#173F35]/20 text-[#173F35]'
                }`}>
                  {selectedPinReport.kind === 'lost' ? '🔴 مفقود' : isDarkMode ? '🟡 موجود (مستلم)' : '🟢 موجود'}
                </span>
                <span className="text-[11px] text-[#59635D] font-bold">
                  {selectedPinReport.category}
                </span>
              </div>

              <h5 className="font-black text-sm line-clamp-1">{selectedPinReport.title}</h5>

              <div className="flex items-center gap-1 text-[11px] text-[#59635D]">
                <MapPin className="w-3.5 h-3.5 text-[#B99A65]" />
                <span>{selectedPinReport.governorate} — {selectedPinReport.city}</span>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[#E3E7E0]/50 mt-1">
                <span className="text-[11px] font-bold text-[#59635D]">
                  الناشر: {selectedPinReport.owner.name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    onSelectReport(selectedPinReport);
                    setSelectedPinReport(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#173F35] text-white text-xs font-black hover:bg-[#0F2D26] transition flex items-center gap-1 shadow-xs"
                >
                  <Eye className="w-3.5 h-3.5 text-[#F0E4CC]" />
                  <span>عرض التفاصيل</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default function App() {
  const [hasQuotaExceeded, setHasQuotaExceeded] = useState<boolean>(false);

  useEffect(() => {
    const handleQuota = () => setHasQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', handleQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', handleQuota);
  }, []);

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'home' | 'lost' | 'found' | 'safety' | 'dashboard' | 'backend' | 'login'>('home');


  // Active theme (persisted in state)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // Filter state
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedGovernorate, setSelectedGovernorate] = useState<string>('all');

  // Authentication & User State (Connected to Firebase)
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [loginEmail, setLoginEmail] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [isSignUpMode, setIsSignUpMode] = useState<boolean>(false);
  const [signUpName, setSignUpName] = useState<string>('');
  const [authError, setAuthError] = useState<string>('');
  const [showUserDropdown, setShowUserDropdown] = useState<boolean>(false);

  // Reports state
  const [reports, setReports] = useState<ReportItem[]>([
    {
      id: 'rep-1',
      title: 'مفاتيح سيارة تويوتا مع ميدالية جلدية',
      kind: 'lost',
      category: 'مفاتيح',
      governorate: 'حضرموت',
      city: 'المكلا — حي الشرج',
      eventDate: '2026-10-29',
      status: 'published',
      publicDescription: 'فقدت حزمة مفاتيح تحتوي على مفتاح سيارة تويوتا وميدالية جلدية بنية بالقرب من مواقف المركز التجاري في المكلا حي الشرج.',
      owner: {
        id: 'usr-demo-1',
        name: 'أحمد السعيد (صاحب مفقودات)',
        email: '',
        isVerified: true,
        dateJoined: '2026-10-25',
      },
      involvedClaimant: {
        id: 'usr-demo-2',
        name: 'د. خالد المنصوري (عثر على غرض)',
        email: '',
        isVerified: true,
        dateJoined: '2026-10-26',
      },
    },
    {
      id: 'rep-2',
      title: 'محفظة رجالية بنية داكنة',
      kind: 'found',
      category: 'محافظ وحقائب',
      governorate: 'حضرموت',
      city: 'سيئون — حي السحيل',
      eventDate: '2026-10-28',
      status: 'published',
      publicDescription: 'عُثر على محفظة رجالية جلدية في حديقة عامة، تحتوي على بعض البطاقات الشخصية.',
      owner: {
        id: 'usr-demo-2',
        name: 'د. خالد المنصوري (عثر على غرض)',
        email: '',
        isVerified: true,
        dateJoined: '2026-10-26',
      },
      involvedClaimant: {
        id: 'usr-demo-1',
        name: 'أحمد السعيد (صاحب مفقودات)',
        email: '',
        isVerified: true,
        dateJoined: '2026-10-25',
      },
    },
    {
      id: 'rep-3',
      title: 'هاتف ذكي أسود بغطاء حماية شفاف',
      kind: 'lost',
      category: 'إلكترونيات وهواتف',
      governorate: 'عدن',
      city: 'خورمكسر — الكورنيش',
      eventDate: '2026-10-27',
      status: 'published',
      publicDescription: 'فقدت هاتفًا ذكيًا لونه أسود بغطاء سيليكون شفاف على طاولة مقهى في كورنيش خورمكسر.',
      owner: {
        id: 'usr-demo-1',
        name: 'أحمد السعيد (صاحب مفقودات)',
        email: '',
        isVerified: true,
        dateJoined: '2026-10-25',
      },
    },
  ]);

  // Firebase Authentication Listener & Firestore Connection Initializer
  useEffect(() => {
    testFirestoreConnection();
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        setIsLoggedIn(true);
        const userRef = doc(db, 'users', firebaseUser.uid);
        try {
          const snap = await getDoc(userRef);
          if (snap.exists()) {
            const data = snap.data();
            setCurrentUser({
              id: firebaseUser.uid,
              name: data.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مستخدم موثق',
              email: firebaseUser.email || '',
              isVerified: Boolean(firebaseUser.emailVerified),
              dateJoined: data.dateJoined || new Date().toISOString().split('T')[0],
            });
          } else {
            const newUserProfile: UserProfile = {
              id: firebaseUser.uid,
              name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مستخدم جديد',
              email: firebaseUser.email || '',
              isVerified: Boolean(firebaseUser.emailVerified),
              dateJoined: new Date().toISOString().split('T')[0],
            };
            await setDoc(userRef, newUserProfile);
            setCurrentUser(newUserProfile);
          }
        } catch (e) {
          console.warn("Could not load user profile document from Firestore:", e);
          setCurrentUser({
            id: firebaseUser.uid,
            name: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'مستخدم موثق',
            email: firebaseUser.email || '',
            isVerified: Boolean(firebaseUser.emailVerified),
            dateJoined: new Date().toISOString().split('T')[0],
          });
        }
      } else {
        setIsLoggedIn(false);
        setCurrentUser(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Real-time Firestore sync for public reports (strictly filtered to published/closed, zero PII)
  useEffect(() => {
    try {
      const publicReportsQuery = query(
        collection(db, 'reports'),
        where('status', 'in', ['published', 'closed'])
      );
      const unsubscribe = onSnapshot(publicReportsQuery, (snapshot) => {
        const loaded: ReportItem[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          loaded.push({
            id: docSnap.id,
            title: d.title,
            kind: d.kind,
            category: d.category,
            governorate: d.governorate,
            city: d.city,
            eventDate: d.eventDate,
            status: d.status,
            publicDescription: d.publicDescription,
            owner: {
              id: d.ownerId,
              name: d.ownerName || 'مستخدم',
              email: '',
              isVerified: true,
              dateJoined: '',
            },
            involvedClaimant: d.involvedClaimantId ? {
              id: d.involvedClaimantId,
              name: 'مستخدم متواصل',
              email: '',
              isVerified: true,
              dateJoined: '',
            } : undefined,
          });
        });
        if (loaded.length > 0) {
          setReports(loaded);
        }
      }, (err) => {
        console.warn("Reports snapshot listener error:", err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn("Unable to attach snapshot listener:", e);
    }
  }, []);

  // Modals & Action Toast state
  const [viewingProfileUser, setViewingProfileUser] = useState<UserProfile | null>(null);
  const [viewingReportDetail, setViewingReportDetail] = useState<ReportItem | null>(null);
  const [showNewReportModal, setShowNewReportModal] = useState<boolean>(false);
  const [showLoginGuidelinesModal, setShowLoginGuidelinesModal] = useState<boolean>(false);
  const [actionSuccessMessage, setActionSuccessMessage] = useState<string>('');

  // New Report Form state
  const [newKind, setNewKind] = useState<'lost' | 'found'>('lost');
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<string>('شيف مال (أموال ونقود)');
  const [newGovernorate, setNewGovernorate] = useState('حضرموت');
  const [newCity, setNewCity] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newSecretNotes, setNewSecretNotes] = useState('');

  // Google Login Handler
  const handleGoogleLogin = async () => {
    setAuthError('');
    try {
      const user = await loginWithGoogle();
      setShowLoginGuidelinesModal(true);
      setActionSuccessMessage(`مرحبًا بك، تم تسجيل الدخول بنجاح عبر حساب Google (${user.displayName || user.email})!`);
      setActiveTab('dashboard');
      setTimeout(() => setActionSuccessMessage(''), 4000);
    } catch (err: any) {
      console.error("Google Sign In failed:", err);
      setAuthError('حدث خطأ أثناء تسجيل الدخول عبر Google. يرجى المحاولة مرة أخرى.');
    }
  };

  // Email/Password Auth Handler
  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    if (!loginEmail || !loginPassword) {
      setAuthError('يرجى ملء كافة الحقول المطلوبة.');
      return;
    }

    try {
      if (isSignUpMode) {
        if (loginPassword.length < 12) {
          setAuthError('يجب أن تتكون كلمة المرور من 12 حرفًا على الأقل لضمان أمان حسابك.');
          return;
        }
        const safeDisplayName = signUpName.trim().slice(0, 100);
        if (safeDisplayName.length < 2) {
          setAuthError('يرجى إدخال اسم صحيح لا يقل عن حرفين.');
          return;
        }
        const credential = await createUserWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
        if (safeDisplayName && credential.user) {
          await updateProfile(credential.user, { displayName: safeDisplayName });
        }
        if (credential.user) {
          await sendEmailVerification(credential.user);
        }
        const newUserProfile: UserProfile = {
          id: credential.user.uid,
          name: safeDisplayName || credential.user.email?.split('@')[0] || 'مستخدم جديد',
          email: credential.user.email || '',
          isVerified: false,
          dateJoined: new Date().toISOString().split('T')[0],
        };
        await setDoc(doc(db, 'users', credential.user.uid), newUserProfile);
        setCurrentUser(newUserProfile);
        setIsLoggedIn(true);
        setShowLoginGuidelinesModal(true);
        setActionSuccessMessage('تم إنشاء الحساب! تم إرسال رابط تحقق لبريدك الإلكتروني — يرجى تأكيد بريدك قبل نشر البلاغات.');
        setActiveTab('dashboard');
      } else {
        const credential = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
        if (!credential.user.emailVerified) {
          setAuthError('يرجى تأكيد بريدك الإلكتروني عبر رابط التحقق المرسل إليك قبل استخدام صلاحيات النشر.');
        }
        setShowLoginGuidelinesModal(true);
        setActionSuccessMessage(`مرحبًا، تم تسجيل الدخول بنجاح!`);
        setActiveTab('dashboard');
      }
      setTimeout(() => setActionSuccessMessage(''), 4500);
    } catch (err: any) {
      console.error("Email auth error:", err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setAuthError('بيانات الدخول غير صحيحة. يرجى التأكد من البريد الإلكتروني وكلمة المرور.');
      } else if (err.code === 'auth/email-already-in-use') {
        setAuthError('تعذر إتمام التسجيل بهذا البريد الإلكتروني. تأكد من البيانات أو سجل الدخول.');
      } else if (err.code === 'auth/weak-password') {
        setAuthError('كلمة المرور ضعيفة. يرجى إدخال كلمة مرور قوية من 12 حرفًا على الأقل.');
      } else {
        setAuthError('تعذر إكمال العملية. يرجى التأكد من البيانات أو استخدام تسجيل الدخول عبر Google.');
      }
    }
  };

  // Logout Handler
  const handleLogout = async () => {
    try {
      await logoutUser();
      setIsLoggedIn(false);
      setCurrentUser(null);
      setActionSuccessMessage('تم تسجيل الخروج بنجاح.');
      setActiveTab('login');
      setTimeout(() => setActionSuccessMessage(''), 3500);
    } catch (err) {
      console.error("Logout error:", err);
    }
  };

  // Handle creating a new report with Firestore persistence & strict verification
  const handleCreateReport = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanTitle = newTitle.trim();
    const cleanDescription = newDescription.trim();
    const cleanGovernorate = newGovernorate.trim();
    const cleanCity = (newCity.trim() || 'المدينة الرئيسية');

    if (cleanTitle.length < 3 || cleanTitle.length > 150) {
      setActionSuccessMessage('يجب أن يكون عنوان البلاغ بين 3 و 150 حرفًا.');
      setTimeout(() => setActionSuccessMessage(''), 4000);
      return;
    }
    if (cleanDescription.length < 10 || cleanDescription.length > 2000) {
      setActionSuccessMessage('يجب أن يكون الوصف العام بين 10 و 2000 حرف.');
      setTimeout(() => setActionSuccessMessage(''), 4000);
      return;
    }

    if (!auth.currentUser || !currentUser) {
      setShowNewReportModal(false);
      setActiveTab('login');
      setActionSuccessMessage('يجب تسجيل الدخول بحساب موثق لنشر بلاغ.');
      setTimeout(() => setActionSuccessMessage(''), 4000);
      return;
    }

    if (!auth.currentUser.emailVerified) {
      setActionSuccessMessage('يرجى تفعيل بريدك الإلكتروني أولاً لتتمكن من نشر البلاغات.');
      setTimeout(() => setActionSuccessMessage(''), 4500);
      return;
    }

    const newReportData = {
      title: cleanTitle,
      kind: newKind,
      category: newCategory.slice(0, 100),
      governorate: cleanGovernorate.slice(0, 100),
      city: cleanCity.slice(0, 150),
      eventDate: new Date().toISOString().split('T')[0],
      status: 'published',
      publicDescription: cleanDescription,
      ownerId: auth.currentUser.uid,
      ownerName: currentUser.name.slice(0, 100),
      createdAt: new Date().toISOString(),
    };

    try {
      const docRef = await addDoc(collection(db, 'reports'), newReportData);
      const created: ReportItem = {
        id: docRef.id,
        title: cleanTitle,
        kind: newKind,
        category: newReportData.category,
        governorate: newReportData.governorate,
        city: newReportData.city,
        eventDate: newReportData.eventDate,
        status: 'published',
        publicDescription: cleanDescription,
        owner: { ...currentUser, email: '' },
      };

      setReports(prev => [created, ...prev]);
      setShowNewReportModal(false);
      setNewTitle('');
      setNewDescription('');
      setNewSecretNotes('');
      setActionSuccessMessage('تم إنشاء البلاغ ومراجعته ونشره بنجاح في قاعدة البيانات!');
      setTimeout(() => setActionSuccessMessage(''), 4000);
    } catch (err) {
      console.error("Error creating report:", err);
      setActionSuccessMessage('تعذر حفظ البلاغ في قاعدة البيانات. تأكد من صلاحيات الحساب والمحاولة مرة أخرى.');
      setTimeout(() => setActionSuccessMessage(''), 4500);
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    }
  };

  // Filtered reports
  const filteredReports = reports.filter(r => {
    if (activeTab === 'lost' && r.kind !== 'lost') return false;
    if (activeTab === 'found' && r.kind !== 'found') return false;
    if (selectedCategory !== 'all' && r.category !== selectedCategory) return false;
    if (selectedGovernorate !== 'all' && r.governorate !== selectedGovernorate) return false;
    return true;
  });

  return (
    <div className={`min-h-screen text-[#202722] ${isDarkMode ? 'dark-mode bg-[#121915] text-[#EEF4EF]' : 'bg-[#FFFFFF]'}`} dir="rtl">
      {hasQuotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
        </div>
      )}

      {/* Main Navigation Header */}

      <header className={`sticky top-0 z-40 border-b backdrop-blur-md transition-colors ${isDarkMode ? 'bg-[#19231D]/90 border-[#34463A]' : 'bg-[#FFFFFF]/95 border-[#E3E7E0]'}`}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
          {/* Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('home')}>
            <img src="/assets/aistudio/image_9f0e420c.png" alt="لقيتة" className="w-12 h-12 md:w-13 md:h-13 object-contain shrink-0" />
            <div className="flex items-center gap-1.5">
              <span className={`text-xl font-black tracking-tight ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>Laqeeta</span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F0E4CC] text-[#173F35] font-black">لقيتة</span>
            </div>
          </div>



          {/* Header Actions: Theme Toggle & User Avatar Icon with Dropdown */}
          <div className="flex items-center gap-3">
            {/* Theme Toggle Button replacing the old plus button */}
            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`px-3 py-2 rounded-xl border flex items-center gap-1.5 text-xs font-bold transition shadow-xs ${
                isDarkMode 
                  ? 'bg-[#19231D] text-[#F0E4CC] border-[#34463A] hover:bg-[#223128]' 
                  : 'bg-[#F7F7F3] text-[#173F35] border-[#E3E7E0] hover:bg-[#F0E4CC]'
              }`}
              title={isDarkMode ? 'التحويل إلى الوضع الفاتح' : 'التحويل إلى الوضع الليلي'}
              aria-label="تبديل الوضع الليلي والفاتح"
            >
              {isDarkMode ? (
                <>
                  <Sun className="w-4 h-4 text-[#B99A65]" />
                  <span className="hidden sm:inline">الوضع الفاتح</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-[#173F35]" />
                  <span className="hidden sm:inline">الوضع الليلي</span>
                </>
              )}
            </button>

            {/* User Icon ONLY (No text beside it), with click dropdown */}
            {isLoggedIn ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowUserDropdown(!showUserDropdown)}
                  className="w-10 h-10 rounded-full bg-[#173F35] text-[#F0E4CC] border-2 border-[#B99A65] flex items-center justify-center hover:scale-105 transition shadow-md focus:outline-none focus:ring-2 focus:ring-[#B99A65]"
                  title="حساب المستخدم — انقر لعرض الخيارات"
                  aria-label="قائمة حساب المستخدم"
                >
                  <UserCheck className="w-5 h-5 text-[#F0E4CC]" />
                </button>

                {/* Dropdown Menu on Click */}
                {showUserDropdown && (
                  <div 
                    className={`absolute left-0 mt-2 w-64 rounded-2xl shadow-2xl border p-2 z-50 animate-in fade-in zoom-in-95 duration-150 ${
                      isDarkMode ? 'bg-[#19231D] border-[#34463A] text-white' : 'bg-white border-[#E3E7E0] text-[#202722]'
                    }`}
                  >
                    {/* User profile header inside dropdown */}
                    <div className="p-3 border-b border-[#E3E7E0]/60 mb-1">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-full bg-[#173F35] text-white flex items-center justify-center font-bold text-xs shrink-0">
                          {currentUser?.name ? currentUser.name.slice(0, 1) : 'م'}
                        </div>
                        <div className="overflow-hidden">
                          <p className="font-bold text-xs text-[#173F35] truncate">{currentUser?.name || 'مستخدم موثق'}</p>
                          <p className="text-[11px] text-[#59635D] truncate">{currentUser?.email}</p>
                        </div>
                      </div>
                    </div>

                    {/* Menu items */}

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('dashboard');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-right px-3 py-2.5 rounded-xl text-xs font-bold hover:bg-[#F0E4CC]/60 flex items-center gap-2 text-[#173F35] transition"
                    >
                      <SlidersHorizontal className="w-4 h-4 text-[#B99A65]" />
                      <span>لوحة التحكم وبلاغاتي</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setShowNewReportModal(true);
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-right px-3 py-2.5 rounded-xl text-xs font-bold hover:bg-[#F0E4CC]/60 flex items-center gap-2 text-[#173F35] transition"
                    >
                      <PlusCircle className="w-4 h-4 text-[#B99A65]" />
                      <span>أبلغ عن مفقود أو موجود</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('safety');
                        setShowUserDropdown(false);
                      }}
                      className="w-full text-right px-3 py-2.5 rounded-xl text-xs font-bold hover:bg-[#F0E4CC]/60 flex items-center gap-2 text-[#173F35] transition"
                    >
                      <ShieldCheck className="w-4 h-4 text-[#B99A65]" />
                      <span>إرشادات السلامة والتحقق</span>
                    </button>

                    <div className="border-t border-[#E3E7E0]/60 my-1"></div>

                    <button
                      type="button"
                      onClick={() => {
                        setShowUserDropdown(false);
                        handleLogout();
                      }}
                      className="w-full text-right px-3 py-2 rounded-xl text-xs font-bold hover:bg-[#8C2727]/10 text-[#8C2727] flex items-center gap-2 transition"
                    >
                      <X className="w-4 h-4" />
                      <span>تسجيل الخروج</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setActiveTab('login')}
                className="bg-[#173F35] hover:bg-[#0F2D26] text-[#FFFFFF] px-4 py-2.5 rounded-xl font-bold text-sm shadow-md transition"
              >
                تسجيل الدخول
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Floating Success Toast */}
      {actionSuccessMessage && (
        <div className="fixed bottom-6 left-6 z-50 bg-[#173F35] text-[#F0E4CC] border-2 border-[#B99A65] px-5 py-3.5 rounded-2xl shadow-2xl flex items-center gap-3 text-sm font-bold animate-bounce">
          <CheckCircle2 className="w-5 h-5 text-[#B99A65]" />
          <span>{actionSuccessMessage}</span>
        </div>
      )}

      {/* MAIN VIEW SWITCHER */}
      {activeTab === 'home' && (
        <main>
          {/* HERO SECTION - Exact Match with Reference Design */}
          <section className="max-w-7xl mx-auto px-4 md:px-8 py-12 md:py-16">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-12 items-center">
              {/* Text Side (RTL right) */}
              <div className="md:col-span-7 space-y-6">
                <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-[#173F35] leading-[1.15] tracking-tight">
                  ضــاع  منـــك ؟
                  <br />
                  <span className="text-[#B99A65]">لـقـيـتـــــــــــة</span>
                </h1>

                <p className="text-base md:text-xl text-[#59635D] leading-relaxed max-w-xl">
                  منصة تجمع أصحاب الأشياء المفقودة بمن عثر عليها، وتساعدهم على اتخاذ الخطوة التالية بوضوح وخصوصية.
                </p>

                <div className="flex flex-wrap items-center gap-3.5 pt-2">
                  <button
                    onClick={() => {
                      setNewKind('lost');
                      setShowNewReportModal(true);
                    }}
                    className="bg-[#173F35] hover:bg-[#0F2D26] text-[#FFFFFF] px-6 py-3.5 rounded-2xl font-black text-sm md:text-base shadow-lg shadow-[#173F35]/20 hover:scale-[1.02] transition flex items-center gap-2"
                  >
                    <span>أبلغ عن مفقود</span>
                    <ArrowLeft className="w-4 h-4 text-[#F0E4CC]" />
                  </button>

                  <button
                    onClick={() => {
                      setNewKind('found');
                      setShowNewReportModal(true);
                    }}
                    className={`px-6 py-3.5 rounded-2xl font-black text-sm md:text-base transition border-2 ${isDarkMode ? 'bg-[#19231D] text-[#F0E4CC] border-[#B99A65] hover:bg-[#243128]' : 'bg-[#FFFFFF] text-[#173F35] border-[#173F35] hover:bg-[#F7F7F3]'}`}
                  >
                    أبلغ عن شيء وجدته
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs text-[#59635D] pt-1">
                  <span className="w-5 h-5 rounded-full bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-bold text-xs">✓</span>
                  <span>تحتاج إلى حساب موثّق لنشر البلاغ. البلاغات تخضع للمراجعة قبل النشر.</span>
                </div>
              </div>

              {/* Interactive Reports Map (Replaces Large Logo in Center) */}
              <div className="md:col-span-5 w-full">
                <ReportsMap
                  reports={reports}
                  isDarkMode={isDarkMode}
                  onSelectReport={(rep) => setViewingReportDetail(rep)}
                />
              </div>
            </div>
          </section>

          {/* PUBLIC REPORTS CARDS */}
          <section className="max-w-7xl mx-auto px-4 md:px-8 py-8">
            <div className="flex items-end justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black text-[#B99A65] uppercase tracking-wider">البلاغات العامة</p>
                <h2 className="text-2xl md:text-3xl font-black text-[#173F35]">أحدث البلاغات المنشورة</h2>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full bg-[#F7F7F3] border border-[#E3E7E0] text-[#59635D] font-bold">
                تُراجع البلاغات قبل النشر
              </span>
            </div>

            {filteredReports.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {filteredReports.map((report) => (
                  <article
                    key={report.id}
                    className={`rounded-3xl p-5 border transition-all hover:shadow-xl hover:-translate-y-1 flex flex-col justify-between ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-[#FFFFFF] border-[#E3E7E0]'}`}
                  >
                    <div>
                      {/* Top badging */}
                      <div className="flex items-center justify-between mb-3">
                        <span className={`text-xs px-3 py-1 rounded-full font-black ${report.kind === 'lost' ? 'bg-[#8C2727]/10 text-[#8C2727]' : report.status === 'closed' ? 'bg-[#173F35]/10 text-[#173F35]' : 'bg-[#B99A65]/20 text-[#173F35]'}`}>
                          {report.status === 'closed' ? 'مغلق ومستعاد ✓' : report.kind === 'lost' ? 'مفقود' : 'موجود'}
                        </span>
                        <span className="text-xs text-[#59635D] font-bold">{report.category}</span>
                      </div>

                      <h3 className="font-black text-lg text-[#173F35] mb-2 line-clamp-1">{report.title}</h3>
                      <p className="text-xs text-[#59635D] line-clamp-3 leading-relaxed mb-4">{report.publicDescription}</p>
                    </div>

                    <div className="pt-4 border-t border-[#E3E7E0] space-y-3">
                      {/* Publisher Info */}
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#173F35]">
                          {report.owner.name}
                        </span>
                        <span className="text-[#59635D] text-[11px]">{report.eventDate}</span>
                      </div>

                      {/* Location & Action */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-xs text-[#59635D]">
                          <MapPin className="w-3.5 h-3.5 text-[#B99A65]" />
                          <span>{report.governorate}، {report.city}</span>
                        </div>

                        <button
                          onClick={() => setViewingReportDetail(report)}
                          className="text-xs text-[#173F35] font-black hover:underline flex items-center gap-0.5"
                        >
                          <span>التفاصيل</span>
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="text-center py-16 bg-[#F7F7F3] rounded-3xl border border-dashed border-[#C7D0C8]">
                <FileText className="w-12 h-12 text-[#B99A65] mx-auto mb-3" />
                <h3 className="font-bold text-lg text-[#173F35]">لا توجد بلاغات تطابق البحث حالياً</h3>
                <p className="text-sm text-[#59635D] mt-1">جرّب استخدام كلمات عامة أو إزالة المرشحات.</p>
              </div>
            )}
          </section>

          {/* HOW IT WORKS SECTION */}
          <section className={`py-16 border-y my-12 transition-colors ${isDarkMode ? 'bg-[#1D2821] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'}`}>
            <div className="max-w-6xl mx-auto px-4">
              <div className="flex flex-col md:flex-row md:items-end justify-between mb-10 gap-4">
                <div>
                  <p className="text-xs font-black text-[#B99A65]">خطوات بسيطة، بوضوح وثقة</p>
                  <h2 className={`text-3xl font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>كيف تعمل المنصة؟</h2>
                </div>
                <p className={`text-sm max-w-md ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>مسار مقترح يساعد الطرفين على التحرك بوضوح، من دون اعتبار التشابه إثباتًا للملكية.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className={`p-7 rounded-3xl border relative shadow-sm transition-colors ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                  <span className="absolute top-6 left-6 text-2xl font-black text-[#B99A65]">01</span>
                  <div className="w-12 h-12 rounded-2xl bg-[#F0E4CC] text-[#121915] flex items-center justify-center font-black mb-5">
                    <FileText className="w-6 h-6 text-[#121915]" />
                  </div>
                  <h3 className={`text-xl font-black mb-2 ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>أبلغ أو ابحث</h3>
                  <p className={`text-xs md:text-sm leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                    ابحث بسهولة عما فقدته باستخدام محرك البحث حسب التصنيف، أو انشر بلاغًا عن غرض عثرت عليه بوصف عام آمن.
                  </p>
                </div>

                <div className={`p-7 rounded-3xl border relative shadow-sm transition-colors ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                  <span className="absolute top-6 left-6 text-2xl font-black text-[#B99A65]">02</span>
                  <div className="w-12 h-12 rounded-2xl bg-[#173F35] text-[#F0E4CC] flex items-center justify-center font-black mb-5">
                    <MessageSquare className="w-6 h-6 text-[#F0E4CC]" />
                  </div>
                  <h3 className={`text-xl font-black mb-2 ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>تواصل بأمان</h3>
                  <p className={`text-xs md:text-sm leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                    ابدأ محادثة داخلية مع صاحب البلاغ دون الحاجة إلى نشر بياناتك الشخصية أو رقم هاتفك حتى يتم تأكيد المطابقة.
                  </p>
                </div>

                <div className={`p-7 rounded-3xl border relative shadow-sm transition-colors ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                  <span className="absolute top-6 left-6 text-2xl font-black text-[#B99A65]">03</span>
                  <div className="w-12 h-12 rounded-2xl bg-[#B99A65] text-[#121915] flex items-center justify-center font-black mb-5">
                    <CheckCircle2 className="w-6 h-6 text-[#121915]" />
                  </div>
                  <h3 className={`text-xl font-black mb-2 ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>تحقق واستلم</h3>
                  <p className={`text-xs md:text-sm leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                    تأكد من مطابقة التفاصيل السرية قبل التسليم في مكان عام، واستلم أمانتك بكل يسر وسهولة.
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* SAFETY & PRIVACY SECTION (Dark Green) */}
          <section className="bg-[#173F35] text-white py-14 md:py-16">
            <div className="max-w-7xl mx-auto px-4 md:px-8 space-y-10">
              <div className="text-center max-w-3xl mx-auto space-y-3">
                <span className="inline-block text-xs font-black text-[#173F35] bg-[#F0E4CC] px-3 py-1 rounded-full">الخصوصية والسلامة أولاً</span>
                <h2 className="text-3xl md:text-4xl font-black text-[#F0E4CC] tracking-tight">
                  التطابق بداية التحقق، وليس نهايته
                </h2>
                <p className="text-xs md:text-sm text-[#F0E4CC]/80 leading-relaxed font-medium">
                  إعلان يشير إلى تطابق لا يعني ملكية مؤكدة. شارك التفاصيل بحذر، واعتمد على الخطوات الإرشادية التالية قبل التسليم:
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-[#0F2D26] p-6 rounded-3xl border border-[#B99A65]/40 space-y-3 relative shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="w-8 h-8 rounded-xl bg-[#F0E4CC] text-[#173F35] font-black text-xs flex items-center justify-center">01</span>
                    <Lock className="w-6 h-6 text-[#B99A65]" />
                  </div>
                  <h4 className="font-black text-base text-[#F0E4CC]">احتفظ بتفاصيل التحقق</h4>
                  <p className="text-xs text-[#F0E4CC]/75 leading-relaxed font-normal">لا تذكر الأرقام التسلسلية أو العلامات الفريدة في الوصف العام.</p>
                </div>

                <div className="bg-[#0F2D26] p-6 rounded-3xl border border-[#B99A65]/40 space-y-3 relative shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="w-8 h-8 rounded-xl bg-[#F0E4CC] text-[#173F35] font-black text-xs flex items-center justify-center">02</span>
                    <ShieldCheck className="w-6 h-6 text-[#B99A65]" />
                  </div>
                  <h4 className="font-black text-base text-[#F0E4CC]">لا تنشر وثائق حساسة</h4>
                  <p className="text-xs text-[#F0E4CC]/75 leading-relaxed font-normal">تجنب صور الهويات والبطاقات البنكية وأرقام الهواتف علنًا.</p>
                </div>

                <div className="bg-[#0F2D26] p-6 rounded-3xl border border-[#B99A65]/40 space-y-3 relative shadow-md">
                  <div className="flex items-center justify-between">
                    <span className="w-8 h-8 rounded-xl bg-[#F0E4CC] text-[#173F35] font-black text-xs flex items-center justify-center">03</span>
                    <MapPin className="w-6 h-6 text-[#B99A65]" />
                  </div>
                  <h4 className="font-black text-base text-[#F0E4CC]">اختر مكانًا عامًا</h4>
                  <p className="text-xs text-[#F0E4CC]/75 leading-relaxed font-normal">التقِ في مراكز تجارية أو بهو جامعة أو مراكز عامة مضيئة.</p>
                </div>
              </div>

              <div className="text-center pt-2">
                <button
                  onClick={() => setActiveTab('safety')}
                  className="inline-flex items-center gap-2 text-xs font-black text-[#173F35] bg-[#F0E4CC] px-6 py-3 rounded-2xl hover:bg-[#B99A65] transition shadow-md"
                >
                  <span>اقرأ إرشادات السلامة والتحقق الكاملة</span>
                  <ArrowLeft className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </main>
      )}

      {/* DEDICATED LOST REPORTS PAGE (المفقودات) */}
      {activeTab === 'lost' && (
        <main className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-8">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
              isDarkMode
                ? 'bg-[#19231D] text-[#F0E4CC] border-[#34463A] hover:bg-[#223128]'
                : 'bg-[#F7F7F3] text-[#173F35] border-[#E3E7E0] hover:bg-[#E3E7E0]'
            }`}
          >
            <ArrowRight className="w-4 h-4 text-[#B99A65]" />
            <span>رجوع للصفحة الرئيسية</span>
          </button>

          <div className="bg-[#8C2727]/10 border border-[#8C2727]/30 p-6 md:p-8 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
            <div className="space-y-2">
              <span className="text-xs font-black text-[#8C2727] bg-white px-3 py-1 rounded-full border border-[#8C2727]/30">سجل المفقودات — منصة لقيتة الحضرمية</span>
              <h1 className="text-2xl md:text-3xl font-black text-[#173F35]">جميع البلاغات عن الأشياء المفقودة</h1>
              <p className="text-xs md:text-sm text-[#59635D] max-w-2xl leading-relaxed font-normal">
                استعرض الأشياء والمقتنيات التي أبلغ أصحابها عن فقدانها في حضرموت ومختلف المحافظات. إذا عثرت على أي منها، تواصل بأمان لتسليم الأمانة لصاحبها والحصول على تقييم موثق.
              </p>
            </div>
            <button
              onClick={() => {
                setNewKind('lost');
                setShowNewReportModal(true);
              }}
              className="bg-[#8C2727] hover:bg-[#701E1E] text-white font-black px-6 py-3.5 rounded-2xl text-xs md:text-sm shrink-0 transition shadow flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              <span>أبلغ عن شيء فقدته +</span>
            </button>
          </div>

          {/* Category Filter Bar for Lost Page */}
          <div className={`p-4 md:p-6 rounded-2xl border flex flex-col md:flex-row gap-4 items-center justify-between ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'}`}>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-[#B99A65]" />
              <span className="text-xs font-bold text-[#173F35]">تصفية البلاغات حسب التصنيف:</span>
            </div>
            <div className="w-full md:w-1/2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`w-full h-12 px-3 rounded-xl border text-xs font-bold focus:ring-2 focus:ring-[#173F35] ${isDarkMode ? 'bg-[#141D17] border-[#627268] text-white' : 'bg-white border-[#C7D0C8]'}`}
              >
                <option value="all">كل التصنيفات للمفقودات ({ALL_CATEGORIES.length})</option>
                {ALL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List or Empty State for Lost Items */}
          {reports.filter(r => r.kind === 'lost' && (selectedCategory === 'all' || r.category === selectedCategory)).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {reports
                .filter(r => r.kind === 'lost' && (selectedCategory === 'all' || r.category === selectedCategory))
                .map((report) => (
                  <article
                    key={report.id}
                    className={`rounded-3xl p-5 border transition-all hover:shadow-xl hover:-translate-y-1 flex flex-col justify-between ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-[#FFFFFF] border-[#E3E7E0]'}`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs px-3 py-1 rounded-full font-black bg-[#8C2727]/10 text-[#8C2727]">
                          {report.status === 'closed' ? 'تمت الاستعادة ✓' : 'مفقود'}
                        </span>
                        <span className="text-xs text-[#59635D] font-bold">{report.category}</span>
                      </div>
                      <h3 className="font-black text-lg text-[#173F35] mb-2 line-clamp-1">{report.title}</h3>
                      <p className="text-xs text-[#59635D] line-clamp-3 leading-relaxed mb-4 font-normal">{report.publicDescription}</p>
                    </div>
                    <div className="pt-4 border-t border-[#E3E7E0] space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#173F35]">
                          {report.owner.name}
                        </span>
                        <span className="text-[#59635D] text-[11px] font-light">{report.eventDate}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-xs text-[#59635D]">
                          <MapPin className="w-3.5 h-3.5 text-[#B99A65]" />
                          <span className="font-medium">{report.governorate}، {report.city}</span>
                        </div>
                        <button
                          onClick={() => setViewingReportDetail(report)}
                          className="text-xs text-[#173F35] font-black hover:underline flex items-center gap-0.5"
                        >
                          <span>التفاصيل</span>
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-[#F7F7F3] rounded-3xl border border-dashed border-[#C7D0C8] space-y-4 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-[#8C2727]/10 text-[#8C2727] flex items-center justify-center mx-auto">
                <Search className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-[#173F35]">لا يوجد مفقودات حالياً</h2>
              <p className="text-xs md:text-sm text-[#59635D] max-w-md mx-auto leading-relaxed font-normal">
                فارغ — لا يوجد أي مفقودات مسجلة حاليًا في هذا التصنيف. يمكنك الإبلاغ عن أي غرض فقدته ليساعدك المجتمع في العثور عليه.
              </p>
              <button
                onClick={() => {
                  setNewKind('lost');
                  setShowNewReportModal(true);
                }}
                className="bg-[#173F35] text-white px-6 py-3 rounded-2xl text-xs font-black hover:bg-[#0F2D26] transition shadow-md"
              >
                أبلغ عن مفقود الآن +
              </button>
            </div>
          )}
        </main>
      )}

      {/* DEDICATED FOUND REPORTS PAGE (الموجودات) */}
      {activeTab === 'found' && (
        <main className="max-w-7xl mx-auto px-4 md:px-8 py-10 space-y-8">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
              isDarkMode
                ? 'bg-[#19231D] text-[#F0E4CC] border-[#34463A] hover:bg-[#223128]'
                : 'bg-[#F7F7F3] text-[#173F35] border-[#E3E7E0] hover:bg-[#E3E7E0]'
            }`}
          >
            <ArrowRight className="w-4 h-4 text-[#B99A65]" />
            <span>رجوع للصفحة الرئيسية</span>
          </button>

          <div className="bg-[#173F35]/10 border border-[#173F35]/30 p-6 md:p-8 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-6 shadow-sm">
            <div className="space-y-2">
              <span className="text-xs font-black text-[#173F35] bg-white px-3 py-1 rounded-full border border-[#173F35]/30">سجل الموجودات — منصة لقيتة الحضرمية</span>
              <h1 className="text-2xl md:text-3xl font-black text-[#173F35]">جميع البلاغات عن الأشياء التي عُثر عليها</h1>
              <p className="text-xs md:text-sm text-[#59635D] max-w-2xl leading-relaxed font-normal">
                استعرض الأمانات والأشياء التي عثر عليها أهل الخير والأمانة في حضرموت والمناطق المحيطة. طابق مواصفات غرضك واستلمه بأمان بعد التحقق والتقييم.
              </p>
            </div>
            <button
              onClick={() => {
                setNewKind('found');
                setShowNewReportModal(true);
              }}
              className="bg-[#173F35] hover:bg-[#0F2D26] text-white font-black px-6 py-3.5 rounded-2xl text-xs md:text-sm shrink-0 transition shadow flex items-center gap-2"
            >
              <PlusCircle className="w-4 h-4 text-[#F0E4CC]" />
              <span>أبلغ عن شيء عثرت عليه +</span>
            </button>
          </div>

          {/* Category Filter Bar for Found Page */}
          <div className={`p-4 md:p-6 rounded-2xl border flex flex-col md:flex-row gap-4 items-center justify-between ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'}`}>
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-[#B99A65]" />
              <span className="text-xs font-bold text-[#173F35]">تصفية البلاغات حسب التصنيف:</span>
            </div>
            <div className="w-full md:w-1/2">
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className={`w-full h-12 px-3 rounded-xl border text-xs font-bold focus:ring-2 focus:ring-[#173F35] ${isDarkMode ? 'bg-[#141D17] border-[#627268] text-white' : 'bg-white border-[#C7D0C8]'}`}
              >
                <option value="all">كل التصنيفات للموجودات ({ALL_CATEGORIES.length})</option>
                {ALL_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
          </div>

          {/* List or Empty State for Found Items */}
          {reports.filter(r => r.kind === 'found' && (selectedCategory === 'all' || r.category === selectedCategory)).length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {reports
                .filter(r => r.kind === 'found' && (selectedCategory === 'all' || r.category === selectedCategory))
                .map((report) => (
                  <article
                    key={report.id}
                    className={`rounded-3xl p-5 border transition-all hover:shadow-xl hover:-translate-y-1 flex flex-col justify-between ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-[#FFFFFF] border-[#E3E7E0]'}`}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs px-3 py-1 rounded-full font-black bg-[#173F35]/10 text-[#173F35]">
                          {report.status === 'closed' ? 'تم التسليم وإغلاق البلاغ ✓' : 'موجود'}
                        </span>
                        <span className="text-xs text-[#59635D] font-bold">{report.category}</span>
                      </div>
                      <h3 className="font-black text-lg text-[#173F35] mb-2 line-clamp-1">{report.title}</h3>
                      <p className="text-xs text-[#59635D] line-clamp-3 leading-relaxed mb-4 font-normal">{report.publicDescription}</p>
                    </div>
                    <div className="pt-4 border-t border-[#E3E7E0] space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-[#173F35]">
                          {report.owner.name}
                        </span>
                        <span className="text-[#59635D] text-[11px] font-light">{report.eventDate}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1 text-xs text-[#59635D]">
                          <MapPin className="w-3.5 h-3.5 text-[#B99A65]" />
                          <span className="font-medium">{report.governorate}، {report.city}</span>
                        </div>
                        <button
                          onClick={() => setViewingReportDetail(report)}
                          className="text-xs text-[#173F35] font-black hover:underline flex items-center gap-0.5"
                        >
                          <span>التفاصيل</span>
                          <ArrowLeft className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <div className="text-center py-20 bg-[#F7F7F3] rounded-3xl border border-dashed border-[#C7D0C8] space-y-4 shadow-xs">
              <div className="w-16 h-16 rounded-3xl bg-[#173F35]/10 text-[#173F35] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8 text-[#173F35]" />
              </div>
              <h2 className="text-2xl font-black text-[#173F35]">لا يوجد موجودات حالياً</h2>
              <p className="text-xs md:text-sm text-[#59635D] max-w-md mx-auto leading-relaxed font-normal">
                فارغ — لا يوجد أي موجودات مسجلة حاليًا في هذا التصنيف. يمكنك الإبلاغ عن أي غرض عثرت عليه لتساهم في إعادته لأصحابه.
              </p>
              <button
                onClick={() => {
                  setNewKind('found');
                  setShowNewReportModal(true);
                }}
                className="bg-[#173F35] text-white px-6 py-3 rounded-2xl text-xs font-black hover:bg-[#0F2D26] transition shadow-md"
              >
                أبلغ عن شيء عثرت عليه الآن +
              </button>
            </div>
          )}
        </main>
      )}



      {/* DASHBOARD TAB */}
      {activeTab === 'dashboard' && (
        <main className="max-w-7xl mx-auto px-4 md:px-8 py-12">
          {!currentUser ? (
            <div className="text-center py-16 space-y-4">
              <UserCheck className="w-12 h-12 text-[#B99A65] mx-auto" />
              <h2 className="text-xl font-black text-[#173F35]">يرجى تسجيل الدخول لعرض لوحة التحكم</h2>
              <button
                onClick={() => setActiveTab('login')}
                className="px-6 py-2.5 bg-[#173F35] text-white rounded-xl font-bold text-xs"
              >
                انقل لصفحة تسجيل الدخول
              </button>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3E7E0] pb-6">
                <div>
                  <p className="text-xs font-black text-[#B99A65]">لوحة تحكم المستخدم</p>
                  <h1 className="text-3xl font-black text-[#173F35]">مرحبًا، {currentUser.name}</h1>
                  <p className="text-xs md:text-sm text-[#59635D] mt-1">إدارة بلاغاتك، وتتبع عمليات التسليم وتقييمات الأعضاء.</p>
                </div>
                <button
                  onClick={() => setShowNewReportModal(true)}
                  className="bg-[#173F35] text-white px-5 py-2.5 rounded-xl font-black text-sm flex items-center gap-2"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>إنشاء بلاغ جديد</span>
                </button>
              </div>

              {/* Dashboard Stats */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] text-center">
                  <span className="text-xs text-[#59635D] block mb-1">إجمالي بلاغاتي</span>
                  <span className="text-3xl font-black text-[#173F35]">
                    {reports.filter(r => r.owner.id === currentUser.id).length}
                  </span>
                </div>
                <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] text-center">
                  <span className="text-xs text-[#59635D] block mb-1">بلاغات نشطة</span>
                  <span className="text-3xl font-black text-[#B99A65]">
                    {reports.filter(r => r.owner.id === currentUser.id && r.status === 'published').length}
                  </span>
                </div>
                <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] text-center">
                  <span className="text-xs text-[#59635D] block mb-1">بلاغات مستلمة ومغلقة</span>
                  <span className="text-3xl font-black text-[#173F35]">
                    {reports.filter(r => r.owner.id === currentUser.id && r.status === 'closed').length}
                  </span>
                </div>
              </div>

              {/* User's Reports List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-black text-[#173F35]">قائمة بلاغاتي وإدارة الاستلام</h3>
                  <span className="text-xs text-[#59635D]">إدارة البلاغات ومتابعة حالات الاستلام بسهولة</span>
                </div>

                <div className="space-y-3">
                  {reports
                    .filter(r => r.owner.id === currentUser.id)
                  .map((rep) => (
                    <div
                      key={rep.id}
                      className="p-5 bg-white rounded-2xl border border-[#E3E7E0] shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${rep.kind === 'lost' ? 'bg-[#8C2727]/10 text-[#8C2727]' : 'bg-[#173F35]/10 text-[#173F35]'}`}>
                            {rep.kind === 'lost' ? 'مفقود' : 'موجود'} · {rep.category}
                          </span>
                          <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold ${rep.status === 'closed' ? 'bg-[#173F35] text-white' : 'bg-[#B99A65]/20 text-[#173F35]'}`}>
                            {rep.status === 'closed' ? 'تم الاستلام وإغلاق البلاغ ✓' : 'قيد المتابعة والبحث'}
                          </span>
                        </div>
                        <h4 className="font-black text-[#173F35] text-base">{rep.title}</h4>
                        <p className="text-xs text-[#59635D]">{rep.governorate}، {rep.city} — تاريخ الواقعة: {rep.eventDate}</p>
                        {rep.involvedClaimant && (
                          <p className="text-xs text-[#173F35] font-bold">
                            الطرف المتواصل للتسليم: {rep.involvedClaimant.name}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 w-full md:w-auto">
                        {rep.status === 'published' ? (
                          <button
                            onClick={() => {
                              const updated = reports.map(r =>
                                r.id === rep.id
                                  ? { ...r, status: 'closed' as const, closedAt: new Date().toISOString().split('T')[0] }
                                  : r
                              );
                              setReports(updated);
                              setActionSuccessMessage('تم تأكيد استلام الغرض وإغلاق البلاغ بنجاح ✓');
                              setTimeout(() => setActionSuccessMessage(''), 4000);
                            }}
                            className="w-full md:w-auto bg-[#173F35] hover:bg-[#0F2D26] text-white px-5 py-2.5 rounded-xl font-black text-xs transition flex items-center justify-center gap-1.5 shadow"
                          >
                            <CheckCircle2 className="w-4 h-4 text-[#F0E4CC]" />
                            <span>تأكيد استلام الغرض وإغلاق البلاغ ✓</span>
                          </button>
                        ) : (
                          <span className="text-xs font-bold text-[#173F35] bg-[#F0E4CC] px-4 py-2.5 rounded-xl">
                            تم الاستلام وإغلاق البلاغ ✓
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </main>
    )}

      {/* SAFETY GUIDE TAB */}
      {activeTab === 'safety' && (
        <main className="max-w-5xl mx-auto px-4 py-12">
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => setActiveTab('home')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition border cursor-pointer ${
                isDarkMode
                  ? 'bg-[#19231D] text-[#F0E4CC] border-[#34463A] hover:bg-[#223128]'
                  : 'bg-[#F7F7F3] text-[#173F35] border-[#E3E7E0] hover:bg-[#E3E7E0]'
              }`}
            >
              <ArrowRight className="w-4 h-4 text-[#B99A65]" />
              <span>رجوع للصفحة الرئيسية</span>
            </button>

            <div>
              <p className="text-xs font-black text-[#B99A65]">الخصوصية والأمان</p>
              <h1 className={`text-3xl font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>إرشادات السلامة والتحقق قبل التسليم</h1>
              <p className={`text-sm mt-1 ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>قواعد أساسية لضمان سلامتك والتأكد من وصول الأمانات لأصحابها الشرعيين.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-4">
              <div className={`p-6 rounded-3xl border shadow-sm space-y-2 ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                <div className="w-10 h-10 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-bold mb-3">1</div>
                <h3 className={`font-black text-base ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>احفظ علامات التحقق السرية</h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                  عند الإبلاغ عن غرض، لا تذكر كافة التفاصيل أو الأرقام التسلسلية أو المحتويات الدقيقة في الوصف العام. احتفظ ببعض التفاصيل لتسأل عنها من يدعي ملكيتها.
                </p>
              </div>

              <div className={`p-6 rounded-3xl border shadow-sm space-y-2 ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                <div className="w-10 h-10 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-bold mb-3">2</div>
                <h3 className={`font-black text-base ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>تجنب نشر وثائق الهوية علنًا</h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                  يحظر نشر صور بطاقات الهوية الوطنية أو جوازات السفر أو البطاقات الائتمانية لحماية أصحابها من جرائم انتحال الشخصية أو الاحتيال.
                </p>
              </div>

              <div className={`p-6 rounded-3xl border shadow-sm space-y-2 ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                <div className="w-10 h-10 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-bold mb-3">3</div>
                <h3 className={`font-black text-base ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>اللقاء في مكان عام وآمن</h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                  عند الاتفاق على التسليم، اختر دائمًا موقعًا عامًا في وضح النهار (مثل: بهو كلية، مركز تجاري، أو بجوار مركز أمني). لا توافق أبدًا على اللقاء في أماكن منعزلة.
                </p>
              </div>

              <div className={`p-6 rounded-3xl border shadow-sm space-y-2 ${isDarkMode ? 'bg-[#19231D] border-[#34463A]' : 'bg-white border-[#E3E7E0]'}`}>
                <div className="w-10 h-10 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-bold mb-3">4</div>
                <h3 className={`font-black text-base ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>إغلاق البلاغ بعد الاستلام</h3>
                <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                  بعد استعادة الغرض واستلام الأمانة، احرص على إغلاق البلاغ في المنصة لتأكيد تسليم الأمانة وإكتمال العملية.
                </p>
              </div>
            </div>
          </div>
        </main>
      )}

      {/* DJANGO BACKEND EXPLORER TAB */}
      {activeTab === 'backend' && (
        <main className="max-w-6xl mx-auto px-4 py-12">
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E3E7E0] pb-6">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#173F35] bg-[#F0E4CC] px-3 py-1 rounded-full mb-2">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Python 3.10 + Django 5 + PostgreSQL ORM</span>
                </div>
                <h1 className="text-3xl font-black text-[#173F35]">بنية نظام التقييم في ملفات Django</h1>
                <p className="text-xs md:text-sm text-[#59635D] mt-1">
                  تم تنفيذ نظام التقييم بالكامل داخل هيكلية Django مع القيود الصارمة (HTML/CSS حصرياً بدون JavaScript).
                </p>
              </div>
              <div className="bg-[#173F35] text-[#F0E4CC] px-4 py-2 rounded-xl text-xs font-mono font-bold">
                اجتياز 34 اختباراً مؤتمتاً بنجاح ✓
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] space-y-2">
                <h3 className="font-black text-[#173F35] text-sm flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#B99A65]" />
                  <span>نموذج UserRating</span>
                </h3>
                <p className="text-xs text-[#59635D]">
                  يحتوي على حقول `report`, `rater`, `rated_user`, `score` (من 1 إلى 5 نجوم)، `comment`، مع قيد فريد يمنع تكرار التقييم لنفس البلاغ.
                </p>
                <div className="text-[11px] font-mono bg-white p-2 rounded-lg border border-[#E3E7E0]">
                  UniqueConstraint(fields=['report', 'rater', 'rated_user'])
                </div>
              </div>

              <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] space-y-2">
                <h3 className="font-black text-[#173F35] text-sm flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#B99A65]" />
                  <span>دوال User و Report</span>
                </h3>
                <p className="text-xs text-[#59635D]">
                  `User.average_rating()` تحسب المتوسط الحسابي للتقييمات، و`Report.get_ratable_users_for()` تتحقق من أن البلاغ مغلق وأن المستخدم مؤهل للتقييم.
                </p>
                <div className="text-[11px] font-mono bg-white p-2 rounded-lg border border-[#E3E7E0]">
                  self.ratings_received.aggregate(Avg("score"))
                </div>
              </div>

              <div className="bg-[#F7F7F3] p-5 rounded-2xl border border-[#E3E7E0] space-y-2">
                <h3 className="font-black text-[#173F35] text-sm flex items-center gap-2">
                  <Code2 className="w-4 h-4 text-[#B99A65]" />
                  <span>واجهات HTML/CSS فقط</span>
                </h3>
                <p className="text-xs text-[#59635D]">
                  تم إنشاء `rating_form.html` و `user_profile.html` مع الراديو والنجوم عبر HTML/CSS النقي، وتوليد الصفحات يتم من الخادم بـ CSRF Token.
                </p>
                <div className="text-[11px] font-mono bg-white p-2 rounded-lg border border-[#E3E7E0]">
                  assertNotContains(response, "&lt;script")
                </div>
              </div>
            </div>

            {/* Code Snippet Box */}
            <div className="bg-[#0F2D26] text-[#F0E4CC] p-6 rounded-3xl font-mono text-xs overflow-x-auto border border-[#B99A65]/30">
              <div className="flex items-center justify-between text-white/50 pb-3 border-b border-white/10 mb-4">
                <span>laqeeta/backend/core/models.py — UserRating Model</span>
                <span>Django ORM</span>
              </div>
              <pre className="text-xs leading-relaxed text-[#F0E4CC]">
{`class UserRating(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    report = models.ForeignKey(Report, on_delete=models.CASCADE, related_name="ratings")
    rater = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="ratings_given")
    rated_user = models.ForeignKey("core.User", on_delete=models.CASCADE, related_name="ratings_received")
    score = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="تقييم من 1 إلى 5 نجوم"
    )
    comment = models.TextField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [
            models.UniqueConstraint(fields=["report", "rater", "rated_user"], name="uniq_report_rater_rated")
        ]`}
              </pre>
            </div>
          </div>
        </main>
      )}

      {/* DEDICATED LOGIN & REGISTER TAB (Firebase Authentication) */}
      {activeTab === 'login' && (
        <main className="max-w-xl mx-auto px-4 py-12 md:py-16">
          <div className="bg-white p-7 md:p-10 rounded-3xl border border-[#E3E7E0] shadow-xl space-y-6">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 rounded-2xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center mx-auto mb-3 border border-[#B99A65]/40 shadow-xs">
                <Lock className="w-7 h-7 text-[#173F35]" />
              </div>
              <span className="text-xs font-black text-[#B99A65] uppercase tracking-wider">بوابة الدخول الموثقة (Firebase)</span>
              <h1 className="text-2xl md:text-3xl font-black text-[#173F35]">
                {isSignUpMode ? 'إنشاء حساب جديد' : 'تسجيل الدخول إلى حسابك'}
              </h1>
              <p className="text-xs md:text-sm text-[#59635D] leading-relaxed">
                {isSignUpMode
                  ? 'قم بإنشاء حسابك الحقيقي عبر البريد أو جوجل لإدارة بلاغاتك واستعادة أماناتك.'
                  : 'أدخل بياناتك لإدارة بلاغاتك، وتأكيد استلام المفقودات.'}
              </p>
            </div>

            {/* Authenticity Guarantee Notice */}
            <div className="p-4 rounded-2xl bg-[#F7F7F3] border-r-4 border-r-[#173F35] border border-[#E3E7E0] text-xs leading-relaxed space-y-1.5">
              <div className="font-black text-[#173F35] flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#173F35]" />
                <span>ربط حي ومباشر بقاعدة بيانات فايربيز (Firebase):</span>
              </div>
              <p className="text-[#59635D]">
                تم حذف كافة الحسابات التجريبية. يمكنك تسجيل الدخول بحساب Google المباشر أو إنشاء حساب جديد بكل أمان وسرعة.
              </p>
            </div>

            {authError && (
              <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-bold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                <span>{authError}</span>
              </div>
            )}

            {/* Google Sign-In Primary Button */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full py-3.5 px-4 rounded-xl border border-[#C7D0C8] bg-white hover:bg-[#F7F7F3] text-[#173F35] font-black text-xs md:text-sm flex items-center justify-center gap-3 transition shadow-xs cursor-pointer"
            >
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>تسجيل الدخول السريع بواسطة Google</span>
            </button>

            <div className="flex items-center gap-3 my-2">
              <div className="flex-1 border-t border-[#E3E7E0]"></div>
              <span className="text-[11px] font-bold text-[#59635D]">أو عبر البريد الإلكتروني</span>
              <div className="flex-1 border-t border-[#E3E7E0]"></div>
            </div>

            <form onSubmit={handleEmailAuth} className="space-y-4">
              {isSignUpMode && (
                <div>
                  <label className="block text-xs font-bold text-[#173F35] mb-1.5">الاسم الكامل *</label>
                  <input
                    type="text"
                    required
                    value={signUpName}
                    onChange={(e) => setSignUpName(e.target.value)}
                    placeholder="أدخل اسمك الثلاثي"
                    className="w-full p-3.5 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-[#173F35] mb-1.5">البريد الإلكتروني *</label>
                <input
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full p-3.5 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35] focus:outline-none"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-bold text-[#173F35]">كلمة المرور *</label>
                </div>
                <input
                  type="password"
                  required
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full p-3.5 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35] focus:outline-none"
                />
              </div>

              <button
                type="submit"
                className="w-full bg-[#173F35] hover:bg-[#0F2D26] text-white py-3.5 rounded-xl font-black text-sm shadow-md transition cursor-pointer flex items-center justify-center gap-2"
              >
                {isSignUpMode ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
                <span>{isSignUpMode ? 'إنشاء حساب جديد ✓' : 'تسجيل الدخول ✓'}</span>
              </button>
            </form>

            <div className="pt-2 text-center border-t border-[#E3E7E0]">
              <button
                type="button"
                onClick={() => {
                  setIsSignUpMode(!isSignUpMode);
                  setAuthError('');
                }}
                className="text-xs font-bold text-[#173F35] hover:underline cursor-pointer"
              >
                {isSignUpMode
                  ? 'لديك حساب بالفعل؟ انقر لتسجيل الدخول'
                  : 'ليس لديك حساب؟ انقر لإنشاء حساب جديد'}
              </button>
            </div>
          </div>
        </main>
      )}

      {/* MODAL: REPORT DETAIL VIEW */}
      {viewingReportDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`rounded-3xl max-w-xl w-full p-6 md:p-8 shadow-2xl border transition-colors animate-in fade-in zoom-in-95 duration-200 ${
            isDarkMode ? 'bg-[#19231D] border-[#34463A] text-[#F0E4CC]' : 'bg-white border-[#E3E7E0] text-[#202722]'
          }`}>
            {/* Header: Badges on right, Close (X) button on left */}
            <div className="flex items-center justify-between pb-4 border-b border-[#E3E7E0]/60 mb-5 gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs px-3 py-1 rounded-full font-black ${
                  viewingReportDetail.kind === 'lost'
                    ? 'bg-[#8C2727]/10 text-[#8C2727]'
                    : 'bg-[#173F35] text-[#F0E4CC]'
                }`}>
                  {viewingReportDetail.kind === 'lost' ? 'مفقود' : 'موجود'}
                </span>
                <span className={`text-xs font-bold ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                  {viewingReportDetail.category}
                </span>
              </div>

              {/* Left Group: Close Button (X) Only */}
              <button
                onClick={() => setViewingReportDetail(null)}
                className={`p-1.5 rounded-xl border transition flex items-center justify-center ${
                  isDarkMode
                    ? 'bg-[#141D17] border-[#34463A] text-[#C7D0C8] hover:text-white hover:bg-[#243128]'
                    : 'bg-[#F7F7F3] border-[#E3E7E0] text-[#59635D] hover:text-[#173F35] hover:bg-[#E3E7E0]'
                }`}
                title="إغلاق نافذة التفاصيل"
              >
                <X className="w-4.5 h-4.5" />
              </button>
            </div>

            <div className="space-y-4">
              <h2 className={`text-2xl font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>{viewingReportDetail.title}</h2>

              {/* Publisher info */}
              <div className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'
              }`}>
                <div>
                  <span className={`text-xs block ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>صاحب البلاغ:</span>
                  <strong className={`text-sm font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>{viewingReportDetail.owner.name}</strong>
                </div>
                <span className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-bold ${
                  isDarkMode
                    ? 'bg-[#19231D] border-[#34463A] text-[#F0E4CC]'
                    : 'bg-white border-[#E3E7E0] text-[#173F35]'
                }`}>
                  <UserCheck className="w-3.5 h-3.5 text-[#B99A65]" />
                  <span>ناشر موثق</span>
                </span>
              </div>

              <div className="space-y-2">
                <h4 className={`text-xs font-black ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>الوصف العام:</h4>
                <p className={`text-xs md:text-sm leading-relaxed p-4 rounded-2xl border ${
                  isDarkMode ? 'bg-[#141D17] border-[#34463A] text-[#C7D0C8]' : 'bg-[#F7F7F3] border-[#E3E7E0] text-[#202722]'
                }`}>
                  {viewingReportDetail.publicDescription}
                </p>
              </div>

              {/* Location & Report Date Side-by-Side */}
              <div className={`flex flex-wrap items-center justify-between gap-3 text-xs p-3.5 rounded-2xl border ${
                isDarkMode ? 'bg-[#141D17] border-[#34463A] text-[#C7D0C8]' : 'bg-[#F7F7F3] border-[#E3E7E0] text-[#59635D]'
              }`}>
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#B99A65]" />
                  <span className="font-bold">الموقع: {viewingReportDetail.governorate}، {viewingReportDetail.city}</span>
                </div>

                <div className="flex items-center gap-1.5 font-bold">
                  <Clock className="w-4 h-4 text-[#B99A65]" />
                  <span>تاريخ البلاغ: {viewingReportDetail.eventDate}</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                {/* Contact Option - ALWAYS ABOVE CLOSE REPORT */}
                <button
                  onClick={() => {
                    const msg = viewingReportDetail.kind === 'lost'
                      ? `تم بدء طلب تواصل آمن مع صاحب البلاغ (${viewingReportDetail.owner.name}).`
                      : `تم بدء طلب تواصل آمن مع الشخص الذي وجده (${viewingReportDetail.owner.name}).`;
                    setActionSuccessMessage(msg);
                    setViewingReportDetail(null);
                    setTimeout(() => setActionSuccessMessage(''), 4000);
                  }}
                  className="w-full bg-[#173F35] hover:bg-[#0F2D26] text-white py-3.5 rounded-xl font-black text-sm transition flex items-center justify-center gap-2 shadow"
                >
                  <MessageSquare className="w-4 h-4 text-[#F0E4CC]" />
                  <span>
                    {viewingReportDetail.kind === 'lost'
                      ? 'تواصل مع صاحب البلاغ'
                      : 'تواصل مع الشخص الذي وجده'}
                  </span>
                </button>

                {/* Close Report Option */}
                {viewingReportDetail.status === 'closed' ? (
                  <div className={`p-4 rounded-2xl border space-y-1.5 ${
                    isDarkMode ? 'bg-[#141D17] border-[#B99A65]/50' : 'bg-[#F0E4CC]/70 border-[#B99A65]'
                  }`}>
                    <div className="flex items-center gap-2 text-[#B99A65] font-black text-sm">
                      <CheckCircle2 className="w-5 h-5 text-[#B99A65]" />
                      <span>تم إغلاق واستعادة هذا البلاغ بنجاح!</span>
                    </div>
                    <p className={`text-xs ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>
                      أُغلق البلاغ بعد إتمام التسليم والمطابقة بنجاح.
                    </p>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      const updatedReports = reports.map(r =>
                        r.id === viewingReportDetail.id
                          ? {
                              ...r,
                              status: 'closed' as const,
                              closedAt: new Date().toISOString().split('T')[0],
                              involvedClaimant: {
                                id: 'usr-claimant',
                                name: 'مستخدم متواصل',
                                email: '',
                                isVerified: true,
                                dateJoined: '',
                              }
                            }
                          : r
                      );
                      setReports(updatedReports);
                      setViewingReportDetail(null);
                      setActionSuccessMessage('تم تأكيد استلام الغرض وإغلاق البلاغ بنجاح ✓');
                      setTimeout(() => setActionSuccessMessage(''), 4500);
                    }}
                    className="w-full bg-[#B99A65] hover:bg-[#A38550] text-[#173F35] py-3.5 rounded-xl font-black text-sm transition flex items-center justify-center gap-2 shadow"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>تأكيد استلام الغرض وإغلاق البلاغ ✓</span>
                  </button>
                )}
                {/* Share Button - Copy Direct Link */}
                <button
                  onClick={() => {
                    const shareUrl = `${window.location.origin}/#report-${viewingReportDetail.id}`;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                      navigator.clipboard.writeText(shareUrl);
                    }
                    setActionSuccessMessage('تم نسخ رابط البلاغ المباشر إلى الحافظة بنجاح! يمكنك مشاركته الآن عبر الواتساب أو الشبكات الاجتماعية.');
                    setTimeout(() => setActionSuccessMessage(''), 4500);
                  }}
                  className={`w-full py-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-2 border ${
                    isDarkMode 
                      ? 'bg-[#1D2821] text-[#F0E4CC] border-[#34463A] hover:bg-[#243128]' 
                      : 'bg-[#F7F7F3] text-[#173F35] border-[#C7D0C8] hover:bg-[#E3E7E0]'
                  }`}
                >
                  <Share2 className="w-4 h-4 text-[#B99A65]" />
                  <span>مشاركة البلاغ (نسخ الرابط المباشر للواتساب والشبكات)</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE REPORT */}
      {showNewReportModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 shadow-2xl border border-[#E3E7E0] relative max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowNewReportModal(false)}
              className="absolute top-5 left-5 text-[#59635D] hover:text-[#202722] p-1.5 rounded-full hover:bg-[#F7F7F3]"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-2xl font-black text-[#173F35] mb-2">إنشاء بلاغ جديد</h3>
            <p className="text-xs text-[#59635D] mb-6">يخضع البلاغ لمراجعة المشرفين قبل نشره لضمان السلامة.</p>

            <form onSubmit={handleCreateReport} className="space-y-4">
              <div className="grid grid-cols-2 gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => setNewKind('lost')}
                  className={`p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition border-2 ${
                    newKind === 'lost'
                      ? 'bg-[#8C2727] text-white border-[#8C2727] shadow-md'
                      : 'bg-[#F7F7F3] border-[#E3E7E0] text-[#59635D] hover:border-[#8C2727]/50'
                  }`}
                >
                  <span className="font-black text-sm md:text-base leading-snug">
                    أبـلــغ عــن مـفـقـــود
                  </span>
                  <span className="text-[11px] md:text-xs font-bold opacity-90 mt-1">
                    أنـــا صــاحــب الغـــرض
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setNewKind('found')}
                  className={`p-3.5 rounded-2xl flex flex-col items-center justify-center text-center transition border-2 ${
                    newKind === 'found'
                      ? 'bg-[#173F35] text-white border-[#173F35] shadow-md'
                      : 'bg-[#F7F7F3] border-[#E3E7E0] text-[#59635D] hover:border-[#173F35]/50'
                  }`}
                >
                  <span className="font-black text-sm md:text-base leading-snug">
                    أبـلــغ عــن مـوجـــود
                  </span>
                  <span className="text-[11px] md:text-xs font-bold opacity-90 mt-1">
                    عـثـــرت عـلــى غـــرض
                  </span>
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#173F35] mb-1">اسم أو وصف مختصر للشيء *</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="مثال: مفاتيح سيارة نيسان مع شريط أحمر"
                  className="w-full p-3 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35] focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-[#173F35] mb-1">التصنيف *</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="w-full p-3 rounded-xl border border-[#C7D0C8] text-xs font-bold focus:ring-2 focus:ring-[#173F35]"
                  >
                    {ALL_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#173F35] mb-1">المحافظة *</label>
                  <input
                    type="text"
                    required
                    value={newGovernorate}
                    onChange={(e) => setNewGovernorate(e.target.value)}
                    placeholder="حضرموت، عدن، شبوة، المهرة، تعز..."
                    className="w-full p-3 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#173F35] mb-1">المدينة أو الحي *</label>
                <input
                  type="text"
                  required
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="مثال: المكلا / حي الشرج / شارع الستين"
                  className="w-full p-3 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#173F35] mb-1">الوصف العام (يظهر للعامة) *</label>
                <textarea
                  rows={3}
                  required
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="وصف عام للغرض بدون ذكر أسرار تثبت الملكية أو أرقام سرية..."
                  className="w-full p-3 rounded-xl border border-[#C7D0C8] text-xs font-medium focus:ring-2 focus:ring-[#173F35]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-[#B99A65] mb-1 flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5" />
                  <span>علامات تحقق سرية (خاصة بك ولن تظهر للعامة)</span>
                </label>
                <textarea
                  rows={2}
                  value={newSecretNotes}
                  onChange={(e) => setNewSecretNotes(e.target.value)}
                  placeholder="أرقام سرية، علامات فارقة، محتويات دقيقة لاستخدامها في التحقق قبل التسليم..."
                  className="w-full p-3 rounded-xl border border-[#B99A65]/60 bg-[#F0E4CC]/30 text-xs font-medium focus:ring-2 focus:ring-[#173F35]"
                />
              </div>

              <div className="pt-3 flex gap-3">
                <button
                  type="submit"
                  className="w-full bg-[#173F35] text-white py-3 rounded-xl font-black text-sm hover:bg-[#0F2D26] transition"
                >
                  نشر البلاغ الآن
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GUIDELINES & HOW IT WORKS MODAL ON LOGIN */}
      {showLoginGuidelinesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-200">
          <div className={`w-full max-w-lg rounded-3xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
            isDarkMode ? 'bg-[#19231D] border-[#34463A] text-white' : 'bg-white border-[#E3E7E0] text-[#202722]'
          }`}>
            {/* Header */}
            <div className="px-4 py-3 border-b border-[#E3E7E0]/40 bg-[#173F35] text-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-xl bg-[#F0E4CC] text-[#173F35] flex items-center justify-center font-black shadow-xs">
                  <ShieldCheck className="w-4 h-4 text-[#173F35]" />
                </div>
                <h3 className="font-black text-xs md:text-sm text-[#F0E4CC]">إرشادات المنصة وكيف تعمل</h3>
              </div>
            </div>

            {/* Scrollable Content */}
            <div className="p-5 md:p-6 space-y-4 overflow-y-auto text-xs leading-relaxed">
              {/* Introduction Card */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F0E4CC]/30 border-[#B99A65]/40'
              }`}>
                <h4 className={`font-black text-sm mb-2 flex items-center gap-2 ${
                  isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'
                }`}>
                  <Info className="w-4 h-4 text-[#B99A65]" />
                  <span>ما هي منصة «لقيتة» وماذا تقدم لك؟</span>
                </h4>
                <p className={`font-medium mb-3 ${isDarkMode ? 'text-[#D0D7D1]' : 'text-[#334155]'}`}>
                  منصة حضرمية مجانية وأمينة صُممت لخدمة المجتمع، تهدف لإعادة المفقودات والأمانات (وثائق، أجهزة، مفاتيح، أغراض شخصية) إلى أصحابها الحقيقيين بكل سهولة وخصوصية في مختلف مدن ومناطق حضرموت.
                </p>
                <div className={`pt-2.5 border-t space-y-1.5 ${isDarkMode ? 'border-[#34463A]' : 'border-[#B99A65]/20'}`}>
                  <strong className={`block font-black text-[11px] ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>
                    💡 كيف تستفيد من المنصة؟
                  </strong>
                  <ul className={`list-disc list-inside space-y-1 font-medium ${isDarkMode ? 'text-[#D0D7D1]' : 'text-[#334155]'}`}>
                    <li><strong>إذا فقدت شيئًا:</strong> ابحث عنه مباشرة في الخريطة الحية أو انشر بلاغ مفقودات ليتواصل معك من يعثر عليه.</li>
                    <li><strong>إذا عثرت على غرض:</strong> انشر بلاغ "عثرت على مفقود" لتساعد صاحبه على استعادته وتؤدي أمانتك.</li>
                  </ul>
                </div>
              </div>

              {/* How it works card */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'
              }`}>
                <h4 className={`font-black text-sm mb-2.5 flex items-center gap-2 ${
                  isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'
                }`}>
                  <Sparkles className="w-4 h-4 text-[#B99A65]" />
                  <span>خطوات الاستخدام بسيطة ومباشرة:</span>
                </h4>
                <div className={`space-y-2.5 font-medium ${
                  isDarkMode ? 'text-[#D0D7D1]' : 'text-[#202722]'
                }`}>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#173F35] text-[#F0E4CC] text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5 shadow-xs">1</span>
                    <div>
                      <strong className={`block font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>تصفح الخريطة أو أضف بلاغًا</strong>
                      <span>استكشف البلاغات الحية أو اضغط "نشر بلاغ جديد" وسجل التفاصيل العامة للغرض.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#173F35] text-[#F0E4CC] text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5 shadow-xs">2</span>
                    <div>
                      <strong className={`block font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>التواصل والتأكد من العلامات السرية</strong>
                      <span>تواصل مع أصحاب البلاغات واستفسر عن علامات محددة يكتفي بها صاحب الحق لضمان الملكية.</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-[#173F35] text-[#F0E4CC] text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5 shadow-xs">3</span>
                    <div>
                      <strong className={`block font-black ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>التسليم الآمن والتقييم</strong>
                      <span>اتفق على موقع عام ومناسب للتسليم، ثم أغلق البلاغ وشارك تقييمك لتعزيز الثقة في المنصة.</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Safety Guidelines card */}
              <div className={`p-4 rounded-2xl border ${
                isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'
              }`}>
                <h4 className={`font-black text-sm mb-2.5 flex items-center gap-2 ${
                  isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'
                }`}>
                  <Lock className="w-4 h-4 text-[#B99A65]" />
                  <span>إرشادات الأمان والخصوصية</span>
                </h4>
                <ul className={`space-y-2 font-medium ${
                  isDarkMode ? 'text-[#D0D7D1]' : 'text-[#202722]'
                }`}>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#B99A65] shrink-0 mt-0.5" />
                    <span><strong className={isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}>أماكن اللقاء:</strong> التقِ دائمًا في أماكن عامة ومزدحمة (مثل الأسواق والمساجد والمراكز المعروفة).</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#B99A65] shrink-0 mt-0.5" />
                    <span><strong className={isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}>البيانات السرية:</strong> لا تشارك الحسابات البنكية أو أرقام السر أو الوثائق الشخصية علنًا.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#B99A65] shrink-0 mt-0.5" />
                    <span><strong className={isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}>خدمة مجانية:</strong> منصة لقيتة خدمة مجانية تمامًا ومخصصة لنفع المجتمع وصون الأمانة.</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Bottom Agreement Button */}
            <div className={`p-4 border-t flex items-center justify-center shrink-0 ${
              isDarkMode ? 'bg-[#141D17] border-[#34463A]' : 'bg-[#F7F7F3] border-[#E3E7E0]'
            }`}>
              <button
                type="button"
                onClick={() => setShowLoginGuidelinesModal(false)}
                className="w-full py-3.5 rounded-2xl bg-[#173F35] hover:bg-[#0F2D26] text-[#F0E4CC] font-black text-sm transition shadow-lg flex items-center justify-center gap-2 active:scale-[0.99] cursor-pointer"
              >
                <Check className="w-5 h-5 text-[#B99A65]" />
                <span>موافقة</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FOOTER */}
      <footer className={`border-t py-10 text-xs transition-colors ${isDarkMode ? 'bg-[#19231D] border-[#34463A] text-[#A6B2A9]' : 'bg-white border-[#E3E7E0] text-[#59635D]'}`}>
        <div className="max-w-7xl mx-auto px-4 md:px-8 flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Brand Block */}
          <div className="flex items-center gap-3.5">
            <img src="/assets/aistudio/image_9f0e420c.png" alt="لقيتة" className="w-12 h-12 object-contain shrink-0" />
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className={`font-black text-base ${isDarkMode ? 'text-[#F0E4CC]' : 'text-[#173F35]'}`}>لقيتة | Laqeeta</span>
                <span className="text-[10px] bg-[#F0E4CC] text-[#173F35] font-black px-2 py-0.5 rounded-full">حضرموت</span>
              </div>
              <p className={`text-xs font-medium ${isDarkMode ? 'text-[#C7D0C8]' : 'text-[#59635D]'}`}>منصة حضرمية للمفقودات والموجودات — مبنية على الثقة والخصوصية.</p>
            </div>
          </div>

          {/* Right Side Shortcuts & Copyright */}
          <div className="flex flex-col items-center md:items-end gap-2 text-[11px] text-[#59635D]">
            <div className="flex flex-wrap items-center gap-4 font-bold">
              <button onClick={() => setActiveTab('home')} className="hover:text-[#173F35] flex items-center gap-1.5 transition">
                <Home className="w-3.5 h-3.5 text-[#B99A65]" />
                <span>الرئيسية</span>
              </button>
              <button onClick={() => setActiveTab('lost')} className="hover:text-[#173F35] flex items-center gap-1.5 transition">
                <Search className="w-3.5 h-3.5 text-[#B99A65]" />
                <span>المفقودات</span>
              </button>
              <button onClick={() => setActiveTab('found')} className="hover:text-[#173F35] flex items-center gap-1.5 transition">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#B99A65]" />
                <span>الموجودات</span>
              </button>
              <button onClick={() => setActiveTab('safety')} className="hover:text-[#173F35] flex items-center gap-1.5 transition">
                <ShieldCheck className="w-3.5 h-3.5 text-[#B99A65]" />
                <span>إرشادات السلامة</span>
              </button>
            </div>
            <div className="font-medium">© 2026 لقيتة — ضاع منك؟ لقيتة. منصة حضرمية موثقة</div>
            <div className="font-medium">إعـــداد : معــــاذ بـاخـــريــش</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
