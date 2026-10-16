import { app } from "./firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const functions = getFunctions(app, "asia-northeast3");
const callCreateProject = httpsCallable(functions, "createProject");
const callListProjects = httpsCallable(functions, "listProjects");
const callGetProject = httpsCallable(functions, "getProject");
const callUpdateProject = httpsCallable(functions, "updateProject");
const callDeleteProject = httpsCallable(functions, "deleteProject");
const auth = getAuth(app);

let isSignedIn = false;
onAuthStateChanged(auth, (user) => {
  isSignedIn = !!user;
  const btnNew = document.getElementById("btn-new-project");
  if (btnNew) btnNew.hidden = !isSignedIn;
});

const PAGE_SIZE = 10;
const MAX_IMAGES = 20;
const MAX_LINKS = 4;
const PLATFORMS = ["PWA", "웹", "Android", "iOS", "macOS", "Windows", "기타"];
const STATUS_BADGE = { "운영중": "answered", "개발중": "pending", "종료": "ended" };

const viewList = document.getElementById("view-list");
const viewDetail = document.getElementById("view-detail");
const viewWrite = document.getElementById("view-write");
const projectGrid = document.getElementById("project-grid");
const listTotal = document.getElementById("list-total");
const pagination = document.getElementById("pagination");
const formProject = document.getElementById("form-project");
const formError = document.getElementById("form-error");
const btnSubmit = document.getElementById("btn-submit");
const fileInput = document.getElementById("file-input");
const filePreviewList = document.getElementById("file-preview-list");
const detailBody = document.getElementById("detail-body");
const toast = document.getElementById("toast");
const confirmModal = document.getElementById("confirm-modal");
const confirmMessage = document.getElementById("confirm-message");
const iconInput = document.getElementById("icon-input");
const iconPreview = document.getElementById("icon-preview");
const linkRows = document.getElementById("link-rows");
const platformChecks = document.getElementById("platform-checks");

platformChecks.innerHTML = PLATFORMS.map((p) =>
  `<label class="check-chip"><input type="checkbox" name="platforms" value="${p}" /><span>${p}</span></label>`
).join("");

let currentPage = 1;
let selectedImages = [];
let editingProjectId = null;
let editingProject = null;
let selectedIcon = null;

let toastTimer = null;
function showToast(message, duration = 2600) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, duration);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmModal.hidden = false;
    const cancelBtn = document.getElementById("confirm-cancel");
    const okBtn = document.getElementById("confirm-ok");
    const cleanup = (result) => {
      confirmModal.hidden = true;
      cancelBtn.removeEventListener("click", onCancel);
      okBtn.removeEventListener("click", onOk);
      resolve(result);
    };
    const onCancel = () => cleanup(false);
    const onOk = () => cleanup(true);
    cancelBtn.addEventListener("click", onCancel);
    okBtn.addEventListener("click", onOk);
  });
}

function showView(view) {
  viewList.hidden = view !== "list";
  viewDetail.hidden = view !== "detail";
  viewWrite.hidden = view !== "write";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

function errorMessage(err, fallback) {
  return (err && err.message) ? err.message : fallback;
}

function statusBadgeHtml(status) {
  return `<span class="badge ${STATUS_BADGE[status] || "pending"}">${escapeHtml(status)}</span>`;
}

function appIconHtml(iconUrl, title, sizeClass = "") {
  if (iconUrl) return `<div class="app-icon ${sizeClass}"><img src="${escapeHtml(iconUrl)}" alt="" /></div>`;
  const initial = (title || "?").trim().charAt(0).toUpperCase();
  return `<div class="app-icon app-icon-fallback ${sizeClass}"><span>${escapeHtml(initial)}</span></div>`;
}

function chipsHtml(d) {
  const chips = [];
  if (d.category) chips.push(d.category);
  chips.push(...(d.platforms || []));
  return chips.map((c) => `<span class="chip">${escapeHtml(c)}</span>`).join("");
}

function safeUrl(url) {
  return /^https?:\/\//i.test(url || "") ? url : "#";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function compressImage(file, maxW = 550, square = false) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 처리할 수 없습니다."));
      img.onload = () => {
        const canvas = document.createElement("canvas");
        if (square) {
          // 아이콘은 가운데를 정사각형으로 잘라 maxW 크기로 맞춘다.
          const side = Math.min(img.width, img.height);
          const size = Math.min(side, maxW);
          canvas.width = size;
          canvas.height = size;
          canvas.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL("image/jpeg", 0.9));
          return;
        }
        let { width, height } = img;
        if (width > maxW) {
          height = Math.round(height * (maxW / width));
          width = maxW;
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function skeletonCardsHtml() {
  return Array.from({ length: 4 }, () => `
    <div class="project-card skeleton-card">
      <div class="project-card-thumb"><div class="skeleton-bar" style="width:100%;height:100%;border-radius:0"></div></div>
      <div class="project-card-info">
        <div class="skeleton-bar" style="width:70%;margin-bottom:10px"></div>
        <div class="skeleton-bar" style="width:45%"></div>
      </div>
    </div>
  `).join("");
}

async function loadList(page) {
  currentPage = page;
  projectGrid.innerHTML = skeletonCardsHtml();
  pagination.innerHTML = "";
  try {
    const res = await callListProjects({ page, pageSize: PAGE_SIZE });
    const { items, total } = res.data;
    listTotal.textContent = `총 ${total}건`;

    if (items.length === 0) {
      projectGrid.innerHTML = '<div class="board-empty">등록된 프로젝트가 없습니다.</div>';
    } else {
      projectGrid.innerHTML = "";
      for (const item of items) {
        const card = document.createElement("div");
        card.className = "project-card";
        const thumbHtml = item.thumbnailUrl
          ? `<img src="${escapeHtml(item.thumbnailUrl)}" loading="lazy" />`
          : `<span class="thumb-empty">준비 중</span>`;
        card.innerHTML = `
          <div class="project-card-thumb${item.thumbnailUrl ? "" : " empty"}">${thumbHtml}</div>
          <div class="project-card-info">
            ${appIconHtml(item.iconUrl, item.title)}
            <div class="project-card-text">
              <h3>${escapeHtml(item.title)}</h3>
              ${item.tagline ? `<p class="project-card-tagline">${escapeHtml(item.tagline)}</p>` : ""}
              <div class="project-card-meta">${statusBadgeHtml(item.status)}${chipsHtml(item)}</div>
            </div>
          </div>
        `;
        card.addEventListener("click", () => openDetail(item.id));
        projectGrid.appendChild(card);
      }
    }
    renderPagination(page, total);
  } catch (err) {
    projectGrid.innerHTML = `<div class="board-empty">${escapeHtml(errorMessage(err, "목록을 불러오지 못했습니다."))}</div>`;
  }
}

function renderPagination(page, total) {
  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1);
  pagination.innerHTML = "";
  if (totalPages <= 1) return;

  const addBtn = (label, targetPage, opts = {}) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    if (opts.active) btn.classList.add("active");
    if (opts.disabled) btn.disabled = true;
    btn.addEventListener("click", () => loadList(targetPage));
    pagination.appendChild(btn);
  };

  addBtn("‹", Math.max(page - 1, 1), { disabled: page === 1 });
  const windowSize = 2;
  const start = Math.max(1, page - windowSize);
  const end = Math.min(totalPages, page + windowSize);
  if (start > 1) {
    addBtn("1", 1);
    if (start > 2) pagination.appendChild(document.createTextNode("…"));
  }
  for (let p = start; p <= end; p++) {
    addBtn(String(p), p, { active: p === page });
  }
  if (end < totalPages) {
    if (end < totalPages - 1) pagination.appendChild(document.createTextNode("…"));
    addBtn(String(totalPages), totalPages);
  }
  addBtn("›", Math.min(page + 1, totalPages), { disabled: page === totalPages });
}

async function openDetail(id) {
  showView("detail");
  detailBody.innerHTML = '<div class="board-empty">불러오는 중…</div>';
  try {
    const res = await callGetProject({ id });
    renderDetail(id, res.data);
  } catch (err) {
    detailBody.innerHTML = `<div class="board-empty">${escapeHtml(errorMessage(err, "불러오지 못했습니다."))}</div>`;
  }
}

function renderDetail(id, d) {
  const links = d.links || [];
  const linksHtml = links.length
    ? `<div class="app-actions">${links.map((l, i) => `
        <a class="btn ${i === 0 ? "btn-primary" : "btn-ghost"}" href="${escapeHtml(safeUrl(l.url))}" target="_blank" rel="noopener">${escapeHtml(l.label)}</a>
      `).join("")}</div>`
    : "";

  const facts = [
    d.version && ["버전", d.version],
    d.updatedDate && ["최근 업데이트", d.updatedDate],
    d.startDate && ["시작일", d.startDate],
    ["스크린샷", `${(d.images || []).length}장`],
  ].filter(Boolean);
  const factsHtml = `<dl class="app-facts">${facts.map(([k, v]) => `
      <div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>
    `).join("")}</dl>`;

  const shotsHtml = (d.images || []).length
    ? `<div class="app-shots">${d.images.map((img) => `
        <figure class="app-shot">
          <a href="${escapeHtml(img.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(img.url)}" loading="lazy" alt="" /></a>
          ${img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ""}
        </figure>
      `).join("")}</div>`
    : '<div class="board-empty">등록된 스크린샷이 없습니다.</div>';

  const adminHtml = d.isAdmin
    ? `<div class="detail-admin-actions">
        <button type="button" class="btn btn-danger" id="btn-delete-project">프로젝트 삭제</button>
        <button type="button" class="btn btn-primary" id="btn-edit-project">수정</button>
      </div>`
    : "";

  detailBody.innerHTML = `
    <div class="app-head">
      ${appIconHtml(d.iconUrl, d.title, "app-icon-lg")}
      <div class="app-head-text">
        <h3>${escapeHtml(d.title)}</h3>
        ${d.tagline ? `<p class="app-tagline">${escapeHtml(d.tagline)}</p>` : ""}
        <div class="project-card-meta">${statusBadgeHtml(d.status)}${chipsHtml(d)}</div>
      </div>
    </div>
    ${linksHtml}
    ${factsHtml}
    <section class="app-section">
      <h4>스크린샷</h4>
      ${shotsHtml}
    </section>
    ${d.description ? `<section class="app-section"><h4>소개</h4><p class="app-description">${escapeHtml(d.description)}</p></section>` : ""}
    ${adminHtml}
  `;

  const editBtn = document.getElementById("btn-edit-project");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      editingProjectId = id;
      editingProject = d;
      openWriteForm(d);
    });
  }

  const deleteBtn = document.getElementById("btn-delete-project");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const ok = await showConfirm("이 프로젝트를 삭제하시겠습니까? 모든 스크린샷이 영구 삭제됩니다.");
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await callDeleteProject({ id });
        showView("list");
        loadList(1);
        showToast("삭제되었습니다.");
      } catch (err) {
        showToast(errorMessage(err, "삭제 중 오류가 발생했습니다."));
        deleteBtn.disabled = false;
      }
    });
  }
}

function openWriteForm(existingData) {
  formProject.reset();
  selectedImages = [];
  filePreviewList.innerHTML = "";
  formError.hidden = true;

  const existingImagesEl = document.getElementById("existing-images");
  const existingPreview = document.getElementById("existing-preview");

  selectedIcon = null;
  iconInput.value = "";
  setIconPreview(existingData ? existingData.iconUrl : "");
  renderLinkRows(existingData ? existingData.links : []);

  if (existingData) {
    formProject.title.value = existingData.title;
    formProject.tagline.value = existingData.tagline || "";
    formProject.description.value = existingData.description || "";
    formProject.category.value = existingData.category || "개인";
    formProject.status.value = existingData.status;
    formProject.version.value = existingData.version || "";
    formProject.startDate.value = existingData.startDate || "";
    formProject.updatedDate.value = existingData.updatedDate || "";
    formProject.querySelectorAll('input[name="platforms"]').forEach((cb) => {
      cb.checked = (existingData.platforms || []).includes(cb.value);
    });
    btnSubmit.textContent = "수정";

    if (existingData.images && existingData.images.length > 0) {
      existingImagesEl.hidden = false;
      existingPreview.innerHTML = existingData.images.map((img) =>
        `<img src="${escapeHtml(img.url)}" />`
      ).join("");
    } else {
      existingImagesEl.hidden = true;
    }
  } else {
    editingProjectId = null;
    editingProject = null;
    formProject.updatedDate.value = todayStr();
    btnSubmit.textContent = "등록";
    existingImagesEl.hidden = true;
    existingPreview.innerHTML = "";
  }

  showView("write");
}

function setIconPreview(url) {
  iconPreview.innerHTML = url ? `<img src="${escapeHtml(url)}" alt="" />` : "<span>+</span>";
}

function renderLinkRows(links) {
  linkRows.innerHTML = "";
  for (let i = 0; i < MAX_LINKS; i++) {
    const link = (links || [])[i] || { label: "", url: "" };
    const row = document.createElement("div");
    row.className = "link-row";
    row.innerHTML = `
      <input type="text" class="link-label" list="link-label-options" maxlength="20" placeholder="버튼 이름" />
      <input type="url" class="link-url" maxlength="300" placeholder="https://" />
    `;
    row.querySelector(".link-label").value = link.label;
    row.querySelector(".link-url").value = link.url;
    linkRows.appendChild(row);
  }
}

function collectLinks() {
  return Array.from(linkRows.querySelectorAll(".link-row"))
    .map((row) => ({
      label: row.querySelector(".link-label").value.trim(),
      url: row.querySelector(".link-url").value.trim(),
    }))
    .filter((l) => l.url);
}

iconInput.addEventListener("change", async () => {
  const file = iconInput.files && iconInput.files[0];
  if (!file) return;
  try {
    const dataUrl = await compressImage(file, 256, true);
    selectedIcon = { data: dataUrl.split(",")[1], contentType: "image/jpeg" };
    setIconPreview(dataUrl);
  } catch (err) {
    formError.textContent = errorMessage(err, "아이콘 처리 중 오류가 발생했습니다.");
    formError.hidden = false;
  }
});

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []);
  const existingCount = editingProject ? (editingProject.images || []).length : 0;
  const maxNew = MAX_IMAGES - existingCount;

  const filesToProcess = files.slice(0, maxNew);
  if (files.length > maxNew) {
    formError.textContent = `스크린샷은 총 ${MAX_IMAGES}장까지 가능합니다. (기존 ${existingCount}장 + 새로 ${maxNew}장)`;
    formError.hidden = false;
  }

  selectedImages = [];
  filePreviewList.innerHTML = "";

  for (const file of filesToProcess) {
    try {
      const dataUrl = await compressImage(file, 550);
      const entry = {
        data: dataUrl.split(",")[1],
        contentType: "image/jpeg",
        caption: "",
        date: todayStr(),
      };
      selectedImages.push(entry);

      const idx = selectedImages.length - 1;
      const div = document.createElement("div");
      div.className = "upload-entry";
      div.innerHTML = `
        <img src="${dataUrl}" />
        <div class="upload-entry-fields">
          <input type="text" placeholder="설명 (선택)" data-idx="${idx}" data-field="caption" maxlength="200" />
          <input type="date" value="${todayStr()}" data-idx="${idx}" data-field="date" />
        </div>
      `;
      div.querySelectorAll("input").forEach((input) => {
        input.addEventListener("input", (e) => {
          const i = Number(e.target.dataset.idx);
          const field = e.target.dataset.field;
          selectedImages[i][field] = e.target.value;
        });
      });
      filePreviewList.appendChild(div);
    } catch (err) {
      formError.textContent = errorMessage(err, "이미지 처리 중 오류가 발생했습니다.");
      formError.hidden = false;
    }
  }
});

formProject.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;

  const fields = {
    title: formProject.title.value.trim(),
    tagline: formProject.tagline.value.trim(),
    description: formProject.description.value.trim(),
    category: formProject.category.value,
    status: formProject.status.value,
    platforms: Array.from(formProject.querySelectorAll('input[name="platforms"]:checked')).map((cb) => cb.value),
    version: formProject.version.value.trim(),
    startDate: formProject.startDate.value,
    updatedDate: formProject.updatedDate.value,
    links: collectLinks(),
  };

  if (!fields.title) {
    formError.textContent = "이름을 입력해주세요.";
    formError.hidden = false;
    return;
  }
  if (fields.links.some((l) => !/^https?:\/\//i.test(l.url))) {
    formError.textContent = "링크는 http:// 또는 https:// 로 시작해야 합니다.";
    formError.hidden = false;
    return;
  }

  btnSubmit.disabled = true;
  const originalText = btnSubmit.textContent;
  btnSubmit.textContent = editingProjectId ? "수정 중…" : "등록 중…";

  try {
    const imagePayload = selectedImages.map((img) => ({
      data: img.data,
      contentType: img.contentType,
      caption: img.caption,
      date: img.date,
    }));

    if (editingProjectId) {
      await callUpdateProject({
        id: editingProjectId,
        ...fields,
        icon: selectedIcon,
        newImages: imagePayload,
      });
      showView("list");
      loadList(currentPage);
      showToast("수정되었습니다.");
    } else {
      await callCreateProject({
        ...fields,
        icon: selectedIcon,
        images: imagePayload,
      });
      showView("list");
      loadList(1);
      showToast("프로젝트가 등록되었습니다.");
    }
    editingProjectId = null;
    editingProject = null;
  } catch (err) {
    formError.textContent = errorMessage(err, "저장 중 오류가 발생했습니다.");
    formError.hidden = false;
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = originalText;
  }
});

document.getElementById("btn-back").addEventListener("click", () => {
  showView("list");
  loadList(currentPage);
});

document.getElementById("btn-new-project").addEventListener("click", () => {
  openWriteForm();
});

document.getElementById("btn-cancel").addEventListener("click", () => {
  if (editingProjectId) {
    openDetail(editingProjectId);
  } else {
    showView("list");
  }
});

loadList(1);
