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

let currentPage = 1;
let selectedImages = [];
let editingProjectId = null;
let editingProject = null;

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

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function compressImage(file, maxW = 550) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 처리할 수 없습니다."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) {
          height = Math.round(height * (maxW / width));
          width = maxW;
        }
        const canvas = document.createElement("canvas");
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
            <h3>${escapeHtml(item.title)}</h3>
            <div class="project-card-meta">
              <span>${escapeHtml(item.startDate)}${item.endDate ? " ~ " + escapeHtml(item.endDate) : " ~"}</span>
              <span class="badge ${item.status === "완료" ? "answered" : "pending"}">${escapeHtml(item.status)}</span>
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
  const statusBadge = `<span class="badge ${d.status === "완료" ? "answered" : "pending"}">${escapeHtml(d.status)}</span>`;

  const timelineHtml = (d.images || []).length
    ? `<div class="timeline">${d.images.map((img) => `
        <div class="timeline-entry">
          <a href="${escapeHtml(img.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(img.url)}" loading="lazy" /></a>
          ${img.caption ? `<div class="timeline-caption">${escapeHtml(img.caption)}</div>` : ""}
          ${img.date ? `<div class="timeline-date">${escapeHtml(img.date)}</div>` : ""}
        </div>
      `).join("")}</div>`
    : '<div class="board-empty" style="margin-top:24px">등록된 스크린샷이 없습니다.</div>';

  const adminHtml = d.isAdmin
    ? `<div class="detail-admin-actions">
        <button type="button" class="btn btn-danger" id="btn-delete-project">프로젝트 삭제</button>
        <button type="button" class="btn btn-primary" id="btn-edit-project">수정</button>
      </div>`
    : "";

  detailBody.innerHTML = `
    <div class="detail-head">
      <h3>${escapeHtml(d.title)}</h3>
      <div class="detail-meta">
        <span>의뢰일: ${escapeHtml(d.startDate)}</span>
        ${d.endDate ? `<span>완료일: ${escapeHtml(d.endDate)}</span>` : ""}
        ${statusBadge}
      </div>
    </div>
    ${timelineHtml}
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

  if (existingData) {
    formProject.title.value = existingData.title;
    formProject.startDate.value = existingData.startDate;
    formProject.endDate.value = existingData.endDate || "";
    formProject.status.value = existingData.status;
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
    formProject.startDate.value = todayStr();
    btnSubmit.textContent = "등록";
    existingImagesEl.hidden = true;
    existingPreview.innerHTML = "";
  }

  showView("write");
}

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

  const title = formProject.title.value.trim();
  const startDate = formProject.startDate.value;
  const endDate = formProject.endDate.value;
  const status = formProject.status.value;

  if (!title) {
    formError.textContent = "제목을 입력해주세요.";
    formError.hidden = false;
    return;
  }
  if (!startDate) {
    formError.textContent = "의뢰일을 입력해주세요.";
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
        title,
        startDate,
        endDate,
        status,
        newImages: imagePayload,
      });
      showView("list");
      loadList(currentPage);
      showToast("수정되었습니다.");
    } else {
      await callCreateProject({
        title,
        startDate,
        endDate,
        status,
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
