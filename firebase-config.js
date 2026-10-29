/**
 * Firebase 연동 설정 및 데이터 동기화 모듈 (Firestore + LocalStorage 하이브리드 지원)
 *
 * [사용 방법]
 * 1. Firebase 콘솔(https://console.firebase.google.com)에서 프로젝트 생성 후 웹 앱을 등록합니다.
 * 2. 아래 DEFAULT_FIREBASE_CONFIG 객체에 본인의 Firebase 설정값을 입력하거나,
 *    웹 앱 내 [관리자 메뉴 -> Firebase 연동 설정] 버튼에서 JSON을 붙여넣으면 즉시 클라우드와 연동됩니다.
 */

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};

const STORAGE_KEYS = {
  FIREBASE_CFG: "welfare_firebase_config",
  MEMBERS: "welfare_members_v2",
  APPLICATIONS: "welfare_applications_v2"
};

let firestoreDb = null;
let firestoreMod = null;
let isFirebaseConnected = false;

function getStoredFirebaseConfig() {
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.FIREBASE_CFG);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("저장된 Firebase 설정 파싱 오류:", err);
  }
  if (DEFAULT_FIREBASE_CONFIG.apiKey && DEFAULT_FIREBASE_CONFIG.projectId) {
    return DEFAULT_FIREBASE_CONFIG;
  }
  return null;
}

async function initDatabase() {
  const cfg = getStoredFirebaseConfig();
  if (!cfg) {
    isFirebaseConnected = false;
    return { connected: false, mode: "local" };
  }

  try {
    const appModule = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
    const fsModule = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

    const app = appModule.initializeApp(cfg);
    firestoreDb = fsModule.getFirestore(app);
    firestoreMod = fsModule;
    isFirebaseConnected = true;

    return { connected: true, mode: "firebase", projectId: cfg.projectId };
  } catch (error) {
    console.warn("Firebase 초기화 실패 (로컬 저장소 모드로 전환):", error);
    isFirebaseConnected = false;
    return { connected: false, mode: "local", error };
  }
}

function getConnectionStatus() {
  return isFirebaseConnected;
}

function saveCustomFirebaseConfig(configObj) {
  localStorage.setItem(STORAGE_KEYS.FIREBASE_CFG, JSON.stringify(configObj));
}

function clearCustomFirebaseConfig() {
  localStorage.removeItem(STORAGE_KEYS.FIREBASE_CFG);
}

// 로컬 기본 샘플 데이터 초기화 (처음 실행 시 관리자 화면 확인용 예시 1건 제공)
function ensureInitialLocalData() {
  const existingMembers = localStorage.getItem(STORAGE_KEYS.MEMBERS);
  if (!existingMembers) {
    const sampleMembers = [
      {
        id: "member_sample_1",
        userId: "hana01",
        userName: "응우옌 티 하나",
        password: "12345678",
        language: ["베트남어", "영어"],
        nationality: "베트남",
        koreanLevel: ["보통"],
        visaStatus: "F-6 (결혼이민)",
        religion: ["불교"],
        phone: "010-2345-6789",
        region: ["부산"],
        age: "31세",
        job: "파트타임 근무",
        family: "배우자, 자녀 1명 (총 3명 동거)",
        createdAt: "2026-10-29 14:20:00"
      }
    ];
    localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(sampleMembers));
  }

  const existingApps = localStorage.getItem(STORAGE_KEYS.APPLICATIONS);
  if (!existingApps) {
    const sampleApps = [
      {
        id: "app_sample_1",
        userId: "hana01",
        userName: "응우옌 티 하나",
        phone: "010-2345-6789",
        nationality: "베트남",
        language: "베트남어, 영어",
        region: "부산",
        koreanEdu: ["중급"],
        medicalSupport: ["의료 지원 신청"],
        legalCounsel: ["심리 상담"],
        otherService: "자녀 초등학교 입학 안내 통역 지원",
        preferredDate: "2026년 11월 10일 오전 10시",
        requestMessage: "평일 오전에 상담을 희망합니다. 베트남어 통역이 있으면 좋겠습니다.",
        createdAt: "2026-10-29 14:35:00"
      }
    ];
    localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(sampleApps));
  }
}

async function fetchAllMembers() {
  ensureInitialLocalData();
  const localList = JSON.parse(localStorage.getItem(STORAGE_KEYS.MEMBERS) || "[]");

  if (isFirebaseConnected && firestoreDb && firestoreMod) {
    try {
      const snap = await firestoreMod.getDocs(firestoreMod.collection(firestoreDb, "members"));
      const remoteList = [];
      snap.forEach((docSnap) => {
        remoteList.push({ id: docSnap.id, ...docSnap.data() });
      });
      if (remoteList.length > 0) {
        remoteList.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(remoteList));
        return remoteList;
      }
    } catch (err) {
      console.warn("Firestore 회원 조회 오류 (로컬 데이터 사용):", err);
    }
  }
  return localList;
}

async function saveMemberRecord(memberObj) {
  const list = await fetchAllMembers();
  const updated = [memberObj, ...list];
  localStorage.setItem(STORAGE_KEYS.MEMBERS, JSON.stringify(updated));

  if (isFirebaseConnected && firestoreDb && firestoreMod) {
    try {
      await firestoreMod.setDoc(
        firestoreMod.doc(firestoreDb, "members", memberObj.id),
        memberObj
      );
    } catch (err) {
      console.warn("Firestore 회원 저장 오류 (로컬에는 저장됨):", err);
    }
  }
  return memberObj;
}

async function fetchAllApplications() {
  ensureInitialLocalData();
  const localList = JSON.parse(localStorage.getItem(STORAGE_KEYS.APPLICATIONS) || "[]");

  if (isFirebaseConnected && firestoreDb && firestoreMod) {
    try {
      const snap = await firestoreMod.getDocs(firestoreMod.collection(firestoreDb, "applications"));
      const remoteList = [];
      snap.forEach((docSnap) => {
        remoteList.push({ id: docSnap.id, ...docSnap.data() });
      });
      if (remoteList.length > 0) {
        remoteList.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
        localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(remoteList));
        return remoteList;
      }
    } catch (err) {
      console.warn("Firestore 신청내역 조회 오류 (로컬 데이터 사용):", err);
    }
  }
  return localList;
}

async function saveApplicationRecord(appObj) {
  const list = await fetchAllApplications();
  const updated = [appObj, ...list];
  localStorage.setItem(STORAGE_KEYS.APPLICATIONS, JSON.stringify(updated));

  if (isFirebaseConnected && firestoreDb && firestoreMod) {
    try {
      await firestoreMod.setDoc(
        firestoreMod.doc(firestoreDb, "applications", appObj.id),
        appObj
      );
    } catch (err) {
      console.warn("Firestore 신청내역 저장 오류 (로컬에는 저장됨):", err);
    }
  }
  return appObj;
}

window.WelfareDB = {
  DEFAULT_FIREBASE_CONFIG,
  initDatabase,
  getConnectionStatus,
  getStoredFirebaseConfig,
  saveCustomFirebaseConfig,
  clearCustomFirebaseConfig,
  fetchAllMembers,
  saveMemberRecord,
  fetchAllApplications,
  saveApplicationRecord
};
