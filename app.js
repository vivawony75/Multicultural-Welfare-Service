(function () {
  const db = window.WelfareDB || {};
  const {
    initDatabase,
    fetchAllMembers,
    saveMemberRecord,
    fetchAllApplications,
    saveApplicationRecord,
    getStoredFirebaseConfig,
    saveCustomFirebaseConfig,
    clearCustomFirebaseConfig,
    safeGetItem,
    safeSetItem,
    safeRemoveItem
  } = db;

  // 관리자 고정 계정 설정 (아이디 admin, 비밀번호 1234)
  const ADMIN_ACCOUNT = {
    userId: "admin",
    password: "1234",
    userName: "총괄 관리자",
    role: "admin"
  };

  const SESSION_KEY = "welfare_current_session_v2";

  const WINDOW_TITLES = {
    about: "🪟 사이트 안내 (전체 공개)",
    apply: "🪟 서비스 신청 (회원 전용 윈도)",
    admin: "🪟 관리자 메뉴 (관리자 전용 윈도)",
    register: "🪟 회원가입 (신규 회원 등록 윈도)"
  };

  // 전역 상태
  let currentUser = null;
  let currentWindow = "about";
  let membersCache = [];
  let applicationsCache = [];

  // 유틸리티: 현재 시각 포맷
  function formatDateTime(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    const hh = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatArrayOrText(val) {
    if (Array.isArray(val)) return val.join(", ");
    return val || "-";
  }

  // 토스트 알림 표시
  function showToast(message, type = "info") {
    const container = document.getElementById("toastContainer");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.25s ease";
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // 윈도형 화면 전환 함수 (상단 메뉴 클릭 시 해당 창만 표시)
  function switchWindow(targetKey) {
    if (!WINDOW_TITLES[targetKey]) return;
    currentWindow = targetKey;

    // 1. 모든 윈도 패널 숨김 처리 후 선택된 패널만 표시
    const panes = document.querySelectorAll(".window-pane");
    panes.forEach((pane) => {
      if (pane.id === `window-${targetKey}`) {
        pane.classList.remove("hidden");
        pane.classList.add("active-pane");
      } else {
        pane.classList.add("hidden");
        pane.classList.remove("active-pane");
      }
    });

    // 2. 상단 메뉴 버튼 active 상태 변경
    const navButtons = document.querySelectorAll(".main-nav .nav-link");
    navButtons.forEach((btn) => {
      if (btn.getAttribute("data-window-target") === targetKey) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    // 3. 윈도 타이틀바 제목 변경
    const windowCurrentTitle = document.getElementById("windowCurrentTitle");
    if (windowCurrentTitle) {
      windowCurrentTitle.textContent = WINDOW_TITLES[targetKey];
    }

    // 4. 권한 상태 다시 확인하여 렌더링
    updateAccessControlUI();

    // 5. 창 전환 시 상단으로 포커스
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  }

  // 로그인 모달 열기/닫기
  function openLoginModal(mode = "member") {
    const loginModal = document.getElementById("loginModal");
    const loginIdInput = document.getElementById("loginId");
    const loginPwInput = document.getElementById("loginPw");
    if (!loginModal) return;

    loginModal.classList.remove("hidden");
    if (mode === "admin" && loginIdInput && loginPwInput) {
      loginIdInput.value = "admin";
      loginPwInput.value = "";
      loginPwInput.focus();
    } else if (loginIdInput) {
      loginIdInput.focus();
    }
  }

  function closeLoginModal() {
    const loginModal = document.getElementById("loginModal");
    if (loginModal) loginModal.classList.add("hidden");
  }

  // 전역 함수로도 노출 (인라인 onclick 및 디버깅 완벽 호환)
  window.switchWindow = switchWindow;
  window.openLoginModal = openLoginModal;
  window.closeLoginModal = closeLoginModal;

  // 세션 불러오기 및 저장
  function loadSession() {
    try {
      const raw = safeGetItem ? safeGetItem(SESSION_KEY) : localStorage.getItem(SESSION_KEY);
      if (raw) {
        currentUser = JSON.parse(raw);
      }
    } catch (e) {
      currentUser = null;
    }
  }

  function saveSession(userObj) {
    currentUser = userObj;
    if (userObj) {
      const serialized = JSON.stringify(userObj);
      if (safeSetItem) safeSetItem(SESSION_KEY, serialized);
    } else {
      if (safeRemoveItem) safeRemoveItem(SESSION_KEY);
    }
    updateAccessControlUI();
  }

  // 권한별 화면 표시 업데이트
  function updateAccessControlUI() {
    const userStatusDisplay = document.getElementById("userStatusDisplay");
    const currentUserText = document.getElementById("currentUserText");
    const openLoginModalBtn = document.getElementById("openLoginModalBtn");
    const navApplyBadge = document.getElementById("navApplyBadge");
    const navAdminBadge = document.getElementById("navAdminBadge");

    const applyLockedView = document.getElementById("applyLockedView");
    const applyAuthorizedView = document.getElementById("applyAuthorizedView");
    const applicantInfoText = document.getElementById("applicantInfoText");

    const adminLockedView = document.getElementById("adminLockedView");
    const adminAuthorizedView = document.getElementById("adminAuthorizedView");

    if (currentUser) {
      userStatusDisplay?.classList.remove("hidden");
      openLoginModalBtn?.classList.add("hidden");
      const roleLabel = currentUser.role === "admin" ? "관리자" : "회원";
      if (currentUserText) {
        currentUserText.textContent = `${currentUser.userName} (${currentUser.userId} · ${roleLabel})`;
      }
    } else {
      userStatusDisplay?.classList.add("hidden");
      openLoginModalBtn?.classList.remove("hidden");
    }

    // [서비스 신청] 접근 제어: 로그인한 회원(또는 관리자)에게만 공개
    if (currentUser && (currentUser.role === "member" || currentUser.role === "admin")) {
      applyLockedView?.classList.add("hidden");
      applyAuthorizedView?.classList.remove("hidden");
      const regionLabel = formatArrayOrText(currentUser.region || currentUser.address || "-");
      if (applicantInfoText) {
        applicantInfoText.textContent = `${currentUser.userName} (${currentUser.userId}) | 국적: ${currentUser.nationality || "관리자"} | 거주 지역: ${regionLabel} | 연락처: ${currentUser.phone || "-"}`;
      }
      if (navApplyBadge) navApplyBadge.textContent = "이용가능";
      renderMyApplications();
    } else {
      applyLockedView?.classList.remove("hidden");
      applyAuthorizedView?.classList.add("hidden");
      if (navApplyBadge) navApplyBadge.textContent = "회원전용";
    }

    // [관리자 메뉴] 접근 제어: 관리자(admin)에게만 공개
    if (currentUser && currentUser.role === "admin") {
      adminLockedView?.classList.add("hidden");
      adminAuthorizedView?.classList.remove("hidden");
      if (navAdminBadge) navAdminBadge.textContent = "접속중";
      renderAdminDashboard();
    } else {
      adminLockedView?.classList.remove("hidden");
      adminAuthorizedView?.classList.add("hidden");
      if (navAdminBadge) navAdminBadge.textContent = "관리자";
    }
  }

  // 전체 데이터 새로고침
  async function refreshAllData() {
    try {
      if (fetchAllMembers) membersCache = await fetchAllMembers();
      if (fetchAllApplications) applicationsCache = await fetchAllApplications();
    } catch (e) {
      console.warn("데이터 새로고침 중 오류:", e);
    }
    updateAccessControlUI();
  }

  // 내 신청 내역 렌더링
  function renderMyApplications() {
    const listEl = document.getElementById("myApplicationsList");
    if (!listEl || !currentUser) return;

    const myApps = applicationsCache.filter((app) =>
      currentUser.role === "admin" ? true : app.userId === currentUser.userId
    );

    if (myApps.length === 0) {
      listEl.innerHTML = `<div class="empty-state">아직 신청하신 복지 서비스 내역이 없습니다. 위 항목을 체크하여 첫 신청서를 작성해 보세요.</div>`;
      return;
    }

    listEl.innerHTML = myApps
      .map((app) => {
        const allServices = [
          ...(app.koreanEdu || []).map((v) => `한국어교육(${v})`),
          ...(app.medicalSupport || []),
          ...(app.legalCounsel || []),
          app.otherService ? `기타(${app.otherService})` : null
        ].filter(Boolean);

        return `
          <div class="my-app-item">
            <div>
              <strong>${escapeHtml(allServices.join(", ") || "선택 항목 없음")}</strong>
              <div style="font-size:0.85rem; color:#475569; margin-top:4px;">
                희망 날짜: <b>${escapeHtml(app.preferredDate)}</b> | 신청일시: ${escapeHtml(app.createdAt)}
              </div>
              ${app.requestMessage ? `<div style="font-size:0.84rem; color:#64748b; margin-top:3px;">부탁의 말: ${escapeHtml(app.requestMessage)}</div>` : ""}
            </div>
            <span class="badge-success">접수 완료</span>
          </div>
        `;
      })
      .join("");
  }

  // 관리자 대시보드 렌더링
  function renderAdminDashboard() {
    const memberCountBadge = document.getElementById("memberCountBadge");
    const applicationCountBadge = document.getElementById("applicationCountBadge");
    if (memberCountBadge) memberCountBadge.textContent = String(membersCache.length);
    if (applicationCountBadge) applicationCountBadge.textContent = String(applicationsCache.length);

    renderAdminMembersList();
    renderAdminApplicationsList();
  }

  function renderAdminMembersList() {
    const container = document.getElementById("membersTableContainer");
    const searchInput = document.getElementById("memberSearchInput");
    if (!container) return;

    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const filtered = membersCache.filter((m) => {
      if (!keyword) return true;
      const langText = formatArrayOrText(m.language);
      const regionText = formatArrayOrText(m.region || m.address);
      const target = `${m.userName} ${m.userId} ${m.nationality} ${langText} ${m.phone} ${regionText} ${m.visaStatus}`.toLowerCase();
      return target.includes(keyword);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state">조건에 해당하는 가입 회원 내역이 없습니다.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map((m, idx) => {
        const langDisplay = formatArrayOrText(m.language);
        const regionDisplay = formatArrayOrText(m.region || m.address);
        return `
        <div class="admin-record-card">
          <div class="record-head">
            <div class="record-title">
              <span class="tag-chip">회원 #${filtered.length - idx}</span>
              <h4>${escapeHtml(m.userName)} (${escapeHtml(m.userId)})</h4>
              <span class="tag-chip">${escapeHtml(m.nationality)}</span>
              <span class="tag-chip">${escapeHtml(regionDisplay)}</span>
              <span class="tag-chip warn">${escapeHtml(m.visaStatus)}</span>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:0.8rem; color:#64748b;">가입일: ${escapeHtml(m.createdAt)}</span>
              <button type="button" class="btn btn-word btn-sm" data-download-member-id="${escapeHtml(m.id)}">
                📄 이 회원 WORD 다운로드 (.doc)
              </button>
            </div>
          </div>
          <div class="record-grid">
            <div class="record-item">
              <span class="label">아이디 / 비밀번호(8자리)</span>
              <span class="value">${escapeHtml(m.userId)} / ${escapeHtml(m.password)}</span>
            </div>
            <div class="record-item">
              <span class="label">1. 사용하는 언어 (복수 선택)</span>
              <span class="value">${escapeHtml(langDisplay)}</span>
            </div>
            <div class="record-item">
              <span class="label">2. 국적</span>
              <span class="value">${escapeHtml(m.nationality)}</span>
            </div>
            <div class="record-item">
              <span class="label">3. 한국어 사용 가능 여부</span>
              <span class="value">${escapeHtml(formatArrayOrText(m.koreanLevel))}</span>
            </div>
            <div class="record-item">
              <span class="label">4. 체류자격</span>
              <span class="value">${escapeHtml(m.visaStatus)}</span>
            </div>
            <div class="record-item">
              <span class="label">5. 종교</span>
              <span class="value">${escapeHtml(formatArrayOrText(m.religion))}</span>
            </div>
            <div class="record-item">
              <span class="label">6. 연락처</span>
              <span class="value">${escapeHtml(m.phone)}</span>
            </div>
            <div class="record-item">
              <span class="label">7. 거주 지역</span>
              <span class="value">${escapeHtml(regionDisplay)}</span>
            </div>
            <div class="record-item">
              <span class="label">8. 나이 / 9. 직업</span>
              <span class="value">${escapeHtml(m.age)} / ${escapeHtml(m.job)}</span>
            </div>
            <div class="record-item full-span">
              <span class="label">10. 가족 (동거인)</span>
              <span class="value">${escapeHtml(m.family)}</span>
            </div>
          </div>
        </div>
      `;
      })
      .join("");
  }

  function renderAdminApplicationsList() {
    const container = document.getElementById("applicationsTableContainer");
    const searchInput = document.getElementById("appSearchInput");
    if (!container) return;

    const keyword = (searchInput?.value || "").trim().toLowerCase();
    const filtered = applicationsCache.filter((app) => {
      if (!keyword) return true;
      const target = [
        app.userName,
        app.userId,
        app.nationality,
        app.region,
        ...(app.koreanEdu || []),
        ...(app.medicalSupport || []),
        ...(app.legalCounsel || []),
        app.otherService,
        app.preferredDate,
        app.requestMessage
      ]
        .join(" ")
        .toLowerCase();
      return target.includes(keyword);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div class="empty-state">조건에 해당하는 서비스 신청 내역이 없습니다.</div>`;
      return;
    }

    container.innerHTML = filtered
      .map(
        (app, idx) => `
        <div class="admin-record-card">
          <div class="record-head">
            <div class="record-title">
              <span class="tag-chip">신청서 #${filtered.length - idx}</span>
              <h4>신청자: ${escapeHtml(app.userName)} (${escapeHtml(app.userId)})</h4>
              <span class="tag-chip">${escapeHtml(app.nationality || "-")}</span>
              ${app.region ? `<span class="tag-chip">${escapeHtml(formatArrayOrText(app.region))}</span>` : ""}
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <span style="font-size:0.8rem; color:#64748b;">신청일: ${escapeHtml(app.createdAt)}</span>
              <button type="button" class="btn btn-word btn-sm" data-download-app-id="${escapeHtml(app.id)}">
                📄 이 신청서 WORD 다운로드 (.doc)
              </button>
            </div>
          </div>
          <div class="record-grid">
            <div class="record-item">
              <span class="label">한국어 교육 (초급/중급/고급)</span>
              <span class="value">${escapeHtml((app.koreanEdu || []).join(", ") || "미선택")}</span>
            </div>
            <div class="record-item">
              <span class="label">의료 지원</span>
              <span class="value">${escapeHtml((app.medicalSupport || []).join(", ") || "미선택")}</span>
            </div>
            <div class="record-item">
              <span class="label">법률 상담 (법률/심리)</span>
              <span class="value">${escapeHtml((app.legalCounsel || []).join(", ") || "미선택")}</span>
            </div>
            <div class="record-item">
              <span class="label">기타 서비스 (직접 입력)</span>
              <span class="value">${escapeHtml(app.otherService || "없음")}</span>
            </div>
            <div class="record-item">
              <span class="label">희망 날짜</span>
              <span class="value">${escapeHtml(app.preferredDate || "-")}</span>
            </div>
            <div class="record-item">
              <span class="label">신청자 연락처 / 사용언어</span>
              <span class="value">${escapeHtml(app.phone || "-")} / ${escapeHtml(formatArrayOrText(app.language))}</span>
            </div>
            <div class="record-item full-span">
              <span class="label">부탁하고 싶은 말</span>
              <span class="value">${escapeHtml(app.requestMessage || "없음")}</span>
            </div>
          </div>
        </div>
      `
      )
      .join("");
  }

  // MS WORD (.doc) 파일 생성 및 다운로드 함수
  function downloadWordFile(filename, title, bodyHtml) {
    const wordDocumentHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office"
            xmlns:w="urn:schemas-microsoft-com:office:word"
            xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <!--[if gte mso 9]>
        <xml>
          <w:WordDocument>
            <w:View>Print</w:View>
            <w:Zoom>100</w:Zoom>
            <w:DoNotOptimizeForBrowser/>
          </w:WordDocument>
        </xml>
        <![endif]-->
        <style>
          @page {
            size: 21cm 29.7cm;
            margin: 2cm 2cm 2cm 2cm;
          }
          body {
            font-family: "맑은 고딕", "Malgun Gothic", "바탕", sans-serif;
            font-size: 10.5pt;
            color: #111827;
            line-height: 1.5;
          }
          h1 {
            text-align: center;
            font-size: 18pt;
            color: #1e3a8a;
            margin-bottom: 6pt;
          }
          .doc-meta {
            text-align: right;
            font-size: 9pt;
            color: #4b5563;
            margin-bottom: 16pt;
          }
          .section-box {
            margin-bottom: 22pt;
            page-break-inside: avoid;
          }
          .section-heading {
            font-size: 12.5pt;
            font-weight: bold;
            background-color: #eff6ff;
            color: #1e40af;
            padding: 6pt 10pt;
            border-left: 4pt solid #2563eb;
            margin-bottom: 8pt;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12pt;
          }
          th, td {
            border: 1pt solid #9ca3af;
            padding: 7pt 10pt;
            text-align: left;
            vertical-align: middle;
            font-size: 10pt;
          }
          th {
            background-color: #f3f4f6;
            font-weight: bold;
            width: 26%;
            color: #1f2937;
          }
          td {
            width: 74%;
          }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <div class="doc-meta">출력 일시: ${formatDateTime()} | 다문화 복지 서비스 통합 관리 시스템</div>
        ${bodyHtml}
      </body>
      </html>
    `;

    const blob = new Blob(["\ufeff", wordDocumentHtml], {
      type: "application/msword;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".doc") ? filename : `${filename}.doc`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`WORD 파일(${link.download}) 다운로드가 완료되었습니다.`, "success");
  }

  function buildMemberTableHtml(m, indexLabel = "") {
    const prefix = indexLabel ? `[${indexLabel}] ` : "";
    const langDisplay = formatArrayOrText(m.language);
    const regionDisplay = formatArrayOrText(m.region || m.address);
    return `
      <div class="section-box">
        <div class="section-heading">${prefix}회원 가입 정보 - ${escapeHtml(m.userName)} (${escapeHtml(m.userId)})</div>
        <table>
          <tr>
            <th>아이디 / 성명</th>
            <td>${escapeHtml(m.userId)} / <strong>${escapeHtml(m.userName)}</strong></td>
          </tr>
          <tr>
            <th>비밀번호 (숫자 8자리)</th>
            <td>${escapeHtml(m.password)}</td>
          </tr>
          <tr>
            <th>1. 사용하는 언어</th>
            <td>${escapeHtml(langDisplay)}</td>
          </tr>
          <tr>
            <th>2. 국적</th>
            <td>${escapeHtml(m.nationality)}</td>
          </tr>
          <tr>
            <th>3. 한국어 사용 가능 여부</th>
            <td>${escapeHtml(formatArrayOrText(m.koreanLevel))}</td>
          </tr>
          <tr>
            <th>4. 체류자격</th>
            <td>${escapeHtml(m.visaStatus)}</td>
          </tr>
          <tr>
            <th>5. 종교</th>
            <td>${escapeHtml(formatArrayOrText(m.religion))}</td>
          </tr>
          <tr>
            <th>6. 연락처</th>
            <td>${escapeHtml(m.phone)}</td>
          </tr>
          <tr>
            <th>7. 거주 지역</th>
            <td>${escapeHtml(regionDisplay)}</td>
          </tr>
          <tr>
            <th>8. 나이</th>
            <td>${escapeHtml(m.age)}</td>
          </tr>
          <tr>
            <th>9. 직업</th>
            <td>${escapeHtml(m.job)}</td>
          </tr>
          <tr>
            <th>10. 가족 (동거인)</th>
            <td>${escapeHtml(m.family)}</td>
          </tr>
          <tr>
            <th>회원 가입 일시</th>
            <td>${escapeHtml(m.createdAt)}</td>
          </tr>
        </table>
      </div>
    `;
  }

  function buildApplicationTableHtml(app, indexLabel = "") {
    const prefix = indexLabel ? `[${indexLabel}] ` : "";
    return `
      <div class="section-box">
        <div class="section-heading">${prefix}복지 서비스 신청서 - 신청자: ${escapeHtml(app.userName)} (${escapeHtml(app.userId)})</div>
        <table>
          <tr>
            <th>신청자 성명 (아이디)</th>
            <td><strong>${escapeHtml(app.userName)}</strong> (${escapeHtml(app.userId)})</td>
          </tr>
          <tr>
            <th>국적 / 거주 지역 / 연락처</th>
            <td>${escapeHtml(app.nationality || "-")} / ${escapeHtml(formatArrayOrText(app.region || "-"))} / ${escapeHtml(app.phone || "-")}</td>
          </tr>
          <tr>
            <th>사용 언어</th>
            <td>${escapeHtml(formatArrayOrText(app.language || "-"))}</td>
          </tr>
          <tr>
            <th>한국어 교육 (초급·중급·고급)</th>
            <td>${escapeHtml((app.koreanEdu || []).join(", ") || "신청 안 함")}</td>
          </tr>
          <tr>
            <th>의료 지원</th>
            <td>${escapeHtml((app.medicalSupport || []).join(", ") || "신청 안 함")}</td>
          </tr>
          <tr>
            <th>법률 상담 (법률상담·심리상담)</th>
            <td>${escapeHtml((app.legalCounsel || []).join(", ") || "신청 안 함")}</td>
          </tr>
          <tr>
            <th>기타 서비스 (직접 입력)</th>
            <td>${escapeHtml(app.otherService || "없음")}</td>
          </tr>
          <tr>
            <th>희망 날짜</th>
            <td><strong>${escapeHtml(app.preferredDate || "-")}</strong></td>
          </tr>
          <tr>
            <th>부탁하고 싶은 말</th>
            <td>${escapeHtml(app.requestMessage || "없음")}</td>
          </tr>
          <tr>
            <th>신청 접수 일시</th>
            <td>${escapeHtml(app.createdAt)}</td>
          </tr>
        </table>
      </div>
    `;
  }

  // 이벤트 리스너 등록 (동기 실행으로 즉시 반응 보장)
  function setupEventListeners() {
    // 0. 문서 전체 클릭 이벤트 위임 (메뉴 전환 및 로그인 모달 버튼 100% 보장)
    document.addEventListener("click", (e) => {
      const winBtn = e.target.closest("[data-window-target]");
      if (winBtn) {
        e.preventDefault();
        const target = winBtn.getAttribute("data-window-target");
        switchWindow(target);
        return;
      }

      const loginTrigger = e.target.closest("[data-open-login]");
      if (loginTrigger) {
        e.preventDefault();
        openLoginModal(loginTrigger.getAttribute("data-open-login"));
        return;
      }
    });

    // 1. 비밀번호 숫자 8자리 실시간 검증
    const regPasswordInput = document.getElementById("regPassword");
    const pwHelpText = document.getElementById("pwHelpText");
    if (regPasswordInput && pwHelpText) {
      regPasswordInput.addEventListener("input", () => {
        regPasswordInput.value = regPasswordInput.value.replace(/[^0-9]/g, "").slice(0, 8);
        const val = regPasswordInput.value;
        if (/^\d{8}$/.test(val)) {
          pwHelpText.textContent = "✓ 사용 가능한 숫자 8자리 비밀번호입니다.";
          pwHelpText.className = "field-hint valid";
        } else {
          pwHelpText.textContent = `숫자 8자리를 입력해 주세요. (현재 ${val.length}/8자리)`;
          pwHelpText.className = "field-hint invalid";
        }
      });
    }

    // 2-A. 사용 언어 '기타' 텍스트 입력 시 체크박스 자동 체크 연동
    const languageOtherCheck = document.getElementById("languageOtherCheck");
    const languageOtherInput = document.getElementById("languageOtherInput");
    if (languageOtherCheck && languageOtherInput) {
      languageOtherInput.addEventListener("input", () => {
        if (languageOtherInput.value.trim().length > 0) {
          languageOtherCheck.checked = true;
        }
      });
      languageOtherCheck.addEventListener("change", () => {
        if (languageOtherCheck.checked) {
          languageOtherInput.focus();
        }
      });
    }

    // 2-B. 거주 지역 '기타' 텍스트 입력 시 체크박스 자동 체크 연동
    const regionOtherCheck = document.getElementById("regionOtherCheck");
    const regionOtherInput = document.getElementById("regionOtherInput");
    if (regionOtherCheck && regionOtherInput) {
      regionOtherInput.addEventListener("input", () => {
        if (regionOtherInput.value.trim().length > 0) {
          regionOtherCheck.checked = true;
        }
      });
      regionOtherCheck.addEventListener("change", () => {
        if (regionOtherCheck.checked) {
          regionOtherInput.focus();
        }
      });
    }

    // 2-C. 종교 '기타' 체크 시 직접입력창 토글
    const religionOtherCheck = document.getElementById("religionOtherCheck");
    const religionOtherInput = document.getElementById("religionOtherInput");
    if (religionOtherCheck && religionOtherInput) {
      religionOtherCheck.addEventListener("change", () => {
        if (religionOtherCheck.checked) {
          religionOtherInput.classList.remove("hidden");
          religionOtherInput.focus();
        } else {
          religionOtherInput.classList.add("hidden");
        }
      });
    }

    // 3. 서비스 신청 '기타' 입력 시 체크박스 자동 연동
    const otherServiceCheck = document.getElementById("otherServiceCheck");
    const otherServiceInput = document.getElementById("otherServiceInput");
    if (otherServiceCheck && otherServiceInput) {
      otherServiceInput.addEventListener("input", () => {
        if (otherServiceInput.value.trim().length > 0) {
          otherServiceCheck.checked = true;
        }
      });
    }

    // 4. 희망 날짜 달력 선택 시 직접 입력란에 반영
    const preferredDatePicker = document.getElementById("preferredDatePicker");
    const preferredDateInput = document.getElementById("preferredDate");
    if (preferredDatePicker && preferredDateInput) {
      preferredDatePicker.addEventListener("change", () => {
        if (preferredDatePicker.value) {
          preferredDateInput.value = preferredDatePicker.value;
        }
      });
    }

    // 5. 회원가입 폼 제출
    const registerForm = document.getElementById("registerForm");
    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const userId = document.getElementById("regId").value.trim();
        const userName = document.getElementById("regName").value.trim();
        const password = document.getElementById("regPassword").value.trim();

        const languageChecks = Array.from(
          registerForm.querySelectorAll('input[name="language"]:checked')
        ).map((el) => el.value);
        const languageOtherText = document.getElementById("languageOtherInput").value.trim();

        const nationality = document.getElementById("regNationality").value.trim();

        const koreanLevel = Array.from(
          registerForm.querySelectorAll('input[name="koreanLevel"]:checked')
        ).map((el) => el.value);

        const visaText = document.getElementById("regVisaText").value.trim();
        const visaChecks = Array.from(
          registerForm.querySelectorAll('input[name="visaStatusCheck"]:checked')
        ).map((el) => el.value);

        const religionChecks = Array.from(
          registerForm.querySelectorAll('input[name="religion"]:checked')
        ).map((el) => el.value);
        const religionOtherText = document.getElementById("religionOtherInput").value.trim();

        const phone = document.getElementById("regPhone").value.trim();

        const regionChecks = Array.from(
          registerForm.querySelectorAll('input[name="region"]:checked')
        ).map((el) => el.value);
        const regionOtherText = document.getElementById("regionOtherInput").value.trim();

        const age = document.getElementById("regAge").value.trim();
        const job = document.getElementById("regJob").value.trim();
        const family = document.getElementById("regFamily").value.trim();

        if (!userId || !userName) {
          showToast("아이디와 이름을 입력해 주세요.", "error");
          return;
        }
        if (userId.toLowerCase() === "admin") {
          showToast("'admin'은 관리자 전용 아이디입니다. 다른 아이디를 입력해 주세요.", "error");
          return;
        }
        if (membersCache.some((m) => m.userId.toLowerCase() === userId.toLowerCase())) {
          showToast("이미 가입된 아이디입니다. 다른 아이디를 사용해 주세요.", "error");
          return;
        }
        if (!/^\d{8}$/.test(password)) {
          showToast("비밀번호는 반드시 숫자 8자리로 입력해야 합니다.", "error");
          document.getElementById("regPassword").focus();
          return;
        }
        if (languageChecks.length === 0 && !languageOtherText) {
          showToast("사용하는 언어를 최소 1개 이상 체크하거나 기타 언어를 입력해 주세요.", "error");
          return;
        }
        if (languageChecks.includes("기타") && !languageOtherText) {
          showToast("사용 언어 '기타'를 선택하셨습니다. 기타 언어를 직접 입력해 주세요.", "error");
          document.getElementById("languageOtherInput").focus();
          return;
        }
        if (!nationality) {
          showToast("국적을 입력해 주세요.", "error");
          return;
        }
        if (koreanLevel.length === 0) {
          showToast("한국어 사용 가능 여부를 최소 1개 이상 체크해 주세요.", "error");
          return;
        }
        if (!visaText && visaChecks.length === 0) {
          showToast("체류자격을 입력하거나 '미등록' 또는 '체류자격 상실'을 체크해 주세요.", "error");
          return;
        }
        if (religionChecks.length === 0) {
          showToast("종교 항목을 체크해 주세요.", "error");
          return;
        }
        if (regionChecks.length === 0 && !regionOtherText) {
          showToast("거주 지역(부산, 김해, 양산, 기타)을 체크해 주세요.", "error");
          return;
        }
        if (regionChecks.includes("기타") && !regionOtherText) {
          showToast("거주 지역 '기타'를 선택하셨습니다. 상세 지역을 직접 입력해 주세요.", "error");
          document.getElementById("regionOtherInput").focus();
          return;
        }
        if (!phone || !age || !job || !family) {
          showToast("연락처, 나이, 직업, 가족(동거인) 항목을 모두 입력해 주세요.", "error");
          return;
        }

        const finalLanguages = languageChecks.map((lang) =>
          lang === "기타" && languageOtherText ? `기타(${languageOtherText})` : lang
        );
        if (!languageChecks.includes("기타") && languageOtherText) {
          finalLanguages.push(`기타(${languageOtherText})`);
        }

        const finalRegions = regionChecks.map((reg) =>
          reg === "기타" && regionOtherText ? `기타(${regionOtherText})` : reg
        );
        if (!regionChecks.includes("기타") && regionOtherText) {
          finalRegions.push(`기타(${regionOtherText})`);
        }

        const finalVisaStatus = [visaText, ...visaChecks].filter(Boolean).join(" / ");
        const finalReligion = religionChecks.map((r) =>
          r === "기타" && religionOtherText ? `기타(${religionOtherText})` : r
        );

        const newMember = {
          id: `member_${Date.now()}`,
          userId,
          userName,
          password,
          language: finalLanguages,
          nationality,
          koreanLevel,
          visaStatus: finalVisaStatus,
          religion: finalReligion,
          phone,
          region: finalRegions,
          age,
          job,
          family,
          role: "member",
          createdAt: formatDateTime()
        };

        await saveMemberRecord(newMember);
        await refreshAllData();

        saveSession(newMember);
        registerForm.reset();
        if (pwHelpText) {
          pwHelpText.textContent = "반드시 숫자 8자리로 입력해 주세요 (0~9 숫자 8개).";
          pwHelpText.className = "field-hint";
        }

        showToast(`${userName}님, 회원가입이 완료되어 [서비스 신청] 창으로 이동합니다!`, "success");
        switchWindow("apply");
      });
    }

    // 6. 복지 서비스 신청 폼 제출
    const serviceApplyForm = document.getElementById("serviceApplyForm");
    if (serviceApplyForm) {
      serviceApplyForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser) {
          showToast("로그인 후 신청하실 수 있습니다.", "error");
          return;
        }

        const koreanEdu = Array.from(
          serviceApplyForm.querySelectorAll('input[name="koreanEdu"]:checked')
        ).map((el) => el.value);

        const medicalSupport = Array.from(
          serviceApplyForm.querySelectorAll('input[name="medicalSupport"]:checked')
        ).map((el) => el.value);

        const legalCounsel = Array.from(
          serviceApplyForm.querySelectorAll('input[name="legalCounsel"]:checked')
        ).map((el) => el.value);

        const isOtherChecked = document.getElementById("otherServiceCheck").checked;
        const otherText = document.getElementById("otherServiceInput").value.trim();
        const otherService = isOtherChecked || otherText ? otherText || "기타 서비스 희망" : "";

        const preferredDate = document.getElementById("preferredDate").value.trim();
        const requestMessage = document.getElementById("requestMessage").value.trim();

        if (
          koreanEdu.length === 0 &&
          medicalSupport.length === 0 &&
          legalCounsel.length === 0 &&
          !otherService
        ) {
          showToast("신청하실 복지 서비스 항목을 최소 1개 이상 체크해 주세요.", "error");
          return;
        }

        if (!preferredDate) {
          showToast("희망 날짜를 입력해 주세요.", "error");
          document.getElementById("preferredDate").focus();
          return;
        }

        const newApp = {
          id: `app_${Date.now()}`,
          userId: currentUser.userId,
          userName: currentUser.userName,
          phone: currentUser.phone || "-",
          nationality: currentUser.nationality || "-",
          language: formatArrayOrText(currentUser.language || "-"),
          region: formatArrayOrText(currentUser.region || currentUser.address || "-"),
          koreanEdu,
          medicalSupport,
          legalCounsel,
          otherService,
          preferredDate,
          requestMessage,
          createdAt: formatDateTime()
        };

        await saveApplicationRecord(newApp);
        await refreshAllData();
        serviceApplyForm.reset();
        showToast("복지 서비스 신청이 정상적으로 접수되었습니다!", "success");
      });
    }

    // 7. 로그인 모달 제어
    const openLoginModalBtn = document.getElementById("openLoginModalBtn");
    const quickLoginHeroBtn = document.getElementById("quickLoginHeroBtn");
    const closeLoginModalBtn = document.getElementById("closeLoginModalBtn");
    const fillAdminCredentialsBtn = document.getElementById("fillAdminCredentialsBtn");
    const goToRegisterFromModal = document.getElementById("goToRegisterFromModal");
    const loginForm = document.getElementById("loginForm");
    const loginIdInput = document.getElementById("loginId");
    const loginPwInput = document.getElementById("loginPw");
    const logoutBtn = document.getElementById("logoutBtn");

    openLoginModalBtn?.addEventListener("click", () => openLoginModal("member"));
    quickLoginHeroBtn?.addEventListener("click", () => openLoginModal("member"));
    closeLoginModalBtn?.addEventListener("click", closeLoginModal);

    fillAdminCredentialsBtn?.addEventListener("click", () => {
      if (loginIdInput) loginIdInput.value = "admin";
      if (loginPwInput) loginPwInput.value = "1234";
    });

    goToRegisterFromModal?.addEventListener("click", () => {
      closeLoginModal();
      switchWindow("register");
    });

    loginForm?.addEventListener("submit", (e) => {
      e.preventDefault();
      const idVal = (loginIdInput?.value || "").trim();
      const pwVal = (loginPwInput?.value || "").trim();

      if (idVal === ADMIN_ACCOUNT.userId && pwVal === ADMIN_ACCOUNT.password) {
        saveSession(ADMIN_ACCOUNT);
        closeLoginModal();
        loginForm.reset();
        showToast("관리자(admin) 계정으로 로그인되었습니다.", "success");
        switchWindow("admin");
        return;
      }

      const matchedMember = membersCache.find(
        (m) => m.userId.toLowerCase() === idVal.toLowerCase() && m.password === pwVal
      );

      if (matchedMember) {
        saveSession({ ...matchedMember, role: "member" });
        closeLoginModal();
        loginForm.reset();
        showToast(`${matchedMember.userName}님 환영합니다!`, "success");
        switchWindow("apply");
        return;
      }

      showToast("아이디 또는 비밀번호가 일치하지 않습니다. 다시 확인해 주세요.", "error");
    });

    logoutBtn?.addEventListener("click", () => {
      saveSession(null);
      showToast("로그아웃되었습니다.", "info");
      switchWindow("about");
    });

    // 8. 관리자 하위메뉴 탭 전환
    const tabMembersBtn = document.getElementById("tabMembersBtn");
    const tabApplicationsBtn = document.getElementById("tabApplicationsBtn");
    const adminMembersPane = document.getElementById("adminMembersPane");
    const adminApplicationsPane = document.getElementById("adminApplicationsPane");

    tabMembersBtn?.addEventListener("click", () => {
      tabMembersBtn.classList.add("active");
      tabApplicationsBtn?.classList.remove("active");
      adminMembersPane?.classList.remove("hidden");
      adminApplicationsPane?.classList.add("hidden");
    });

    tabApplicationsBtn?.addEventListener("click", () => {
      tabApplicationsBtn.classList.add("active");
      tabMembersBtn?.classList.remove("active");
      adminApplicationsPane?.classList.remove("hidden");
      adminMembersPane?.classList.add("hidden");
    });

    // 9. 관리자 검색 필터
    document.getElementById("memberSearchInput")?.addEventListener("input", renderAdminMembersList);
    document.getElementById("appSearchInput")?.addEventListener("input", renderAdminApplicationsList);

    // 10. 관리자 WORD 다운로드
    document.getElementById("downloadAllMembersWordBtn")?.addEventListener("click", () => {
      if (membersCache.length === 0) {
        showToast("다운로드할 회원 내역이 없습니다.", "error");
        return;
      }
      const body = membersCache
        .map((m, idx) => buildMemberTableHtml(m, `회원 ${idx + 1}`))
        .join("");
      const today = formatDateTime().slice(0, 10);
      downloadWordFile(`전체_회원가입내역_${today}.doc`, "다문화 복지 서비스 회원가입 명부 (전체)", body);
    });

    document.getElementById("downloadAllAppsWordBtn")?.addEventListener("click", () => {
      if (applicationsCache.length === 0) {
        showToast("다운로드할 서비스 신청 내역이 없습니다.", "error");
        return;
      }
      const body = applicationsCache
        .map((app, idx) => buildApplicationTableHtml(app, `신청 ${idx + 1}`))
        .join("");
      const today = formatDateTime().slice(0, 10);
      downloadWordFile(`전체_서비스신청내역_${today}.doc`, "다문화 복지 서비스 신청서 내역 (전체)", body);
    });

    document.getElementById("membersTableContainer")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-download-member-id]");
      if (!btn) return;
      const memberId = btn.getAttribute("data-download-member-id");
      const target = membersCache.find((m) => m.id === memberId);
      if (target) {
        downloadWordFile(
          `회원가입정보_${target.userName}_${target.userId}.doc`,
          `회원 가입 상세 정보 (${target.userName})`,
          buildMemberTableHtml(target)
        );
      }
    });

    document.getElementById("applicationsTableContainer")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-download-app-id]");
      if (!btn) return;
      const appId = btn.getAttribute("data-download-app-id");
      const target = applicationsCache.find((a) => a.id === appId);
      if (target) {
        downloadWordFile(
          `복지서비스신청서_${target.userName}_${target.userId}.doc`,
          `다문화 복지 서비스 신청서 (${target.userName})`,
          buildApplicationTableHtml(target)
        );
      }
    });

    // 11. Firebase 설정 모달
    const firebaseModal = document.getElementById("firebaseModal");
    const openFirebaseModalBtn = document.getElementById("openFirebaseModalBtn");
    const closeFirebaseModalBtn = document.getElementById("closeFirebaseModalBtn");
    const firebaseConfigJsonInput = document.getElementById("firebaseConfigJsonInput");
    const saveFirebaseConfigBtn = document.getElementById("saveFirebaseConfigBtn");
    const clearFirebaseConfigBtn = document.getElementById("clearFirebaseConfigBtn");

    openFirebaseModalBtn?.addEventListener("click", () => {
      const cfg = getStoredFirebaseConfig ? getStoredFirebaseConfig() : null;
      if (firebaseConfigJsonInput) {
        firebaseConfigJsonInput.value = cfg ? JSON.stringify(cfg, null, 2) : "";
      }
      firebaseModal?.classList.remove("hidden");
    });

    closeFirebaseModalBtn?.addEventListener("click", () => {
      firebaseModal?.classList.add("hidden");
    });

    saveFirebaseConfigBtn?.addEventListener("click", async () => {
      const raw = (firebaseConfigJsonInput?.value || "").trim();
      if (!raw) {
        showToast("Firebase 설정 JSON을 입력해 주세요.", "error");
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed.apiKey || !parsed.projectId) {
          showToast("apiKey와 projectId가 포함된 올바른 Firebase JSON을 입력해 주세요.", "error");
          return;
        }
        if (saveCustomFirebaseConfig) saveCustomFirebaseConfig(parsed);
        const status = await initDatabase();
        updateDbBadge(status);
        await refreshAllData();
        firebaseModal?.classList.add("hidden");
        showToast("Firebase 클라우드 연동이 활성화되었습니다!", "success");
      } catch (err) {
        showToast("JSON 형식이 올바르지 않습니다. 따옴표와 괄호를 확인해 주세요.", "error");
      }
    });

    clearFirebaseConfigBtn?.addEventListener("click", async () => {
      if (clearCustomFirebaseConfig) clearCustomFirebaseConfig();
      const status = await initDatabase();
      updateDbBadge(status);
      firebaseModal?.classList.add("hidden");
      showToast("로컬 저장소 전용 모드로 전환되었습니다.", "info");
    });
  }

  function updateDbBadge(status) {
    const dbStatusBadge = document.getElementById("dbStatusBadge");
    if (!dbStatusBadge || !status) return;
    if (status.connected) {
      dbStatusBadge.textContent = `🔥 Firebase 클라우드 연동됨 (${status.projectId})`;
    } else {
      dbStatusBadge.textContent = "💾 로컬 저장소 연동됨 (Firebase 설정 가능)";
    }
  }

  // 앱 시작: 이벤트 리스너를 가장 먼저 등록하여 버튼이 즉시 작동하도록 보장
  async function bootstrap() {
    setupEventListeners();
    loadSession();
    switchWindow("about");
    try {
      if (initDatabase) {
        const dbStatus = await initDatabase();
        updateDbBadge(dbStatus);
      }
      await refreshAllData();
    } catch (err) {
      console.warn("초기화 중 비동기 작업 경고:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
