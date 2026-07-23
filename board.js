import { app } from "./firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const functions = getFunctions(app, "asia-northeast3");
const callSubmitInquiry = httpsCallable(functions, "submitInquiry");
const callListInquiries = httpsCallable(functions, "listInquiries");
const callVerifyPassword = httpsCallable(functions, "verifyInquiryPassword");
const callPostAnswer = httpsCallable(functions, "postAnswer");
const callAdminGetInquiry = httpsCallable(functions, "adminGetInquiry");
const callDeleteInquiry = httpsCallable(functions, "deleteInquiry");
const auth = getAuth(app);
let isSignedIn = false;
onAuthStateChanged(auth, (user) => {
  isSignedIn = !!user;
});

const PAGE_SIZE = 15;
const MAX_IMAGES = 3;

const viewList = document.getElementById("view-list");
const viewWrite = document.getElementById("view-write");
const viewDetail = document.getElementById("view-detail");
const listBody = document.getElementById("list-body");
const listTotal = document.getElementById("list-total");
const pagination = document.getElementById("pagination");
const formWrite = document.getElementById("form-write");
const formError = document.getElementById("form-error");
const btnSubmit = document.getElementById("btn-submit");
const fileInput = document.getElementById("file-input");
const filePreview = document.getElementById("file-preview");
const detailBody = document.getElementById("detail-body");
const modal = document.getElementById("password-modal");
const modalPassword = document.getElementById("modal-password");
const modalError = document.getElementById("modal-error");
const toast = document.getElementById("toast");
const confirmModal = document.getElementById("confirm-modal");
const confirmMessage = document.getElementById("confirm-message");

let currentPage = 1;
let selectedImages = [];
let pendingDetailId = null;

let toastTimer = null;
function showToast(message, duration = 2600) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
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
  viewWrite.hidden = view !== "write";
  viewDetail.hidden = view !== "detail";
}

function formatDate(millis) {
  if (!millis) return "-";
  return new Date(millis).toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function errorMessage(err, fallback) {
  return (err && err.message) ? err.message : fallback;
}

function skeletonRowsHtml() {
  const widths = [
    ["78%", "44%", "52%"],
    ["58%", "36%", "48%"],
    ["70%", "40%", "44%"],
    ["50%", "48%", "56%"],
  ];
  return widths
    .map(
      ([title, author, date]) => `
        <tr class="skeleton-row">
          <td><span class="skeleton-bar" style="width:${title}"></span></td>
          <td><span class="skeleton-bar" style="width:${author}"></span></td>
          <td><span class="skeleton-bar" style="width:${date}"></span></td>
          <td><span class="skeleton-bar skeleton-pill"></span></td>
        </tr>`
    )
    .join("");
}

async function loadList(page) {
  currentPage = page;
  listBody.innerHTML = skeletonRowsHtml();
  pagination.innerHTML = "";
  try {
    const res = await callListInquiries({ page, pageSize: PAGE_SIZE });
    const { items, total } = res.data;
    listTotal.textContent = `총 ${total}건`;

    if (items.length === 0) {
      listBody.innerHTML = '<tr><td colspan="4" class="board-empty">등록된 문의가 없습니다.</td></tr>';
    } else {
      listBody.innerHTML = "";
      for (const item of items) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td class="title-cell"><span class="lock">🔒</span>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(item.authorName)}</td>
          <td>${formatDate(item.createdAtMillis)}</td>
          <td><span class="badge ${item.status === "answered" ? "answered" : "pending"}">${item.status === "answered" ? "답변완료" : "답변대기"}</span></td>
        `;
        tr.addEventListener("click", () => openDetail(item.id));
        listBody.appendChild(tr);
      }
    }
    renderPagination(page, total);
  } catch (err) {
    listBody.innerHTML = `<tr><td colspan="4" class="board-empty">${escapeHtml(errorMessage(err, "목록을 불러오지 못했습니다."))}</td></tr>`;
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

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}

async function openDetail(id) {
  pendingDetailId = id;

  if (isSignedIn) {
    try {
      const res = await callAdminGetInquiry({ id });
      renderDetail(res.data);
      showView("detail");
      return;
    } catch (err) {
      // not the admin account (or stale session) — fall through to password prompt
    }
  }

  modalPassword.value = "";
  modalError.hidden = true;
  modal.hidden = false;
  modalPassword.focus();
}

document.getElementById("modal-cancel").addEventListener("click", () => {
  modal.hidden = true;
  pendingDetailId = null;
});

document.getElementById("modal-confirm").addEventListener("click", verifyAndShow);
modalPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verifyAndShow();
});

async function verifyAndShow() {
  if (!pendingDetailId) return;
  const password = modalPassword.value;
  if (!password) return;
  modalError.hidden = true;
  try {
    const res = await callVerifyPassword({ id: pendingDetailId, password });
    modal.hidden = true;
    renderDetail(res.data);
    showView("detail");
  } catch (err) {
    modalError.textContent = errorMessage(err, "확인 중 오류가 발생했습니다.");
    modalError.hidden = false;
  }
}

let currentDetail = null;

function renderDetail(d) {
  currentDetail = d;
  const linksHtml = (d.links || []).length
    ? `<div class="detail-section"><h4>참고 링크</h4><div class="detail-links">${d.links.map((l) => `<a href="${escapeHtml(l)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l)}</a>`).join("")}</div></div>`
    : "";
  const imagesHtml = (d.imageUrls || []).length
    ? `<div class="detail-section"><h4>스크린샷</h4><div class="detail-images">${d.imageUrls.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(u)}" loading="lazy" /></a>`).join("")}</div></div>`
    : "";
  const answerHtml = d.answer
    ? `<div class="detail-section"><h4>답변</h4><div class="detail-answer"><p>${escapeHtml(d.answer)}</p></div></div>`
    : "";
  const adminFormHtml = d.isAdmin
    ? `<div class="detail-section">
        <h4>관리자 답변</h4>
        <form id="admin-answer-form" class="board-form">
          <div class="field-row">
            <textarea name="answer" rows="4" maxlength="2000" placeholder="답변을 입력하세요">${escapeHtml(d.answer || "")}</textarea>
          </div>
          <div id="admin-answer-error" class="form-error" hidden></div>
          <div class="field-row actions">
            <button type="button" class="btn btn-danger" id="btn-delete-inquiry">이 문의 삭제</button>
            <button type="submit" class="btn btn-primary">답변 등록</button>
          </div>
        </form>
      </div>`
    : "";

  detailBody.innerHTML = `
    <div class="detail-head">
      <h3>${escapeHtml(d.title)}</h3>
      <div class="detail-meta">
        <span>${escapeHtml(d.authorName)}</span>
        <span>${escapeHtml(d.contact)}</span>
        <span>${formatDate(d.createdAtMillis)}</span>
        <span class="badge ${d.status === "answered" ? "answered" : "pending"}">${d.status === "answered" ? "답변완료" : "답변대기"}</span>
      </div>
    </div>
    <div class="detail-section"><h4>문의 내용</h4><p>${escapeHtml(d.content)}</p></div>
    ${linksHtml}
    ${imagesHtml}
    ${answerHtml}
    ${adminFormHtml}
  `;

  const adminForm = document.getElementById("admin-answer-form");
  if (adminForm) {
    adminForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const answerError = document.getElementById("admin-answer-error");
      answerError.hidden = true;
      const answer = new FormData(adminForm).get("answer").trim();
      const submitBtn = adminForm.querySelector("button[type=submit]");
      submitBtn.disabled = true;
      try {
        await callPostAnswer({ id: pendingDetailId, answer });
        renderDetail({ ...currentDetail, answer, status: "answered" });
      } catch (err) {
        answerError.textContent = errorMessage(err, "답변 등록 중 오류가 발생했습니다.");
        answerError.hidden = false;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  const deleteBtn = document.getElementById("btn-delete-inquiry");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const ok = await showConfirm("이 문의를 삭제하시겠습니까? 첨부한 스크린샷을 포함해 영구적으로 삭제되며 되돌릴 수 없습니다.");
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await callDeleteInquiry({ id: pendingDetailId });
        showView("list");
        loadList(1);
        showToast("삭제되었습니다.");
      } catch (err) {
        const answerError = document.getElementById("admin-answer-error");
        answerError.textContent = errorMessage(err, "삭제 중 오류가 발생했습니다.");
        answerError.hidden = false;
        deleteBtn.disabled = false;
      }
    });
  }
}

document.getElementById("btn-back").addEventListener("click", () => {
  showView("list");
  loadList(currentPage);
});

document.getElementById("btn-new").addEventListener("click", () => {
  formWrite.reset();
  selectedImages = [];
  filePreview.innerHTML = "";
  formError.hidden = true;
  showView("write");
});

document.getElementById("btn-cancel").addEventListener("click", () => {
  showView("list");
});

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("이미지를 읽을 수 없습니다."));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error("이미지를 처리할 수 없습니다."));
      img.onload = () => {
        const maxW = 1600;
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

fileInput.addEventListener("change", async () => {
  const files = Array.from(fileInput.files || []).slice(0, MAX_IMAGES);
  if (fileInput.files && fileInput.files.length > MAX_IMAGES) {
    formError.textContent = `스크린샷은 최대 ${MAX_IMAGES}장까지 업로드할 수 있습니다.`;
    formError.hidden = false;
  }
  selectedImages = [];
  filePreview.innerHTML = "";
  for (const file of files) {
    try {
      const dataUrl = await compressImage(file);
      selectedImages.push({ data: dataUrl.split(",")[1], contentType: "image/jpeg" });
      const img = document.createElement("img");
      img.src = dataUrl;
      filePreview.appendChild(img);
    } catch (err) {
      formError.textContent = errorMessage(err, "이미지 처리 중 오류가 발생했습니다.");
      formError.hidden = false;
    }
  }
});

formWrite.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.hidden = true;
  const fd = new FormData(formWrite);
  const links = [fd.get("link1"), fd.get("link2"), fd.get("link3")]
    .map((l) => (l || "").trim())
    .filter((l) => l !== "")
    .map((l) => (/^https?:\/\//i.test(l) ? l : `https://${l}`));

  const payload = {
    title: (fd.get("title") || "").trim(),
    authorName: (fd.get("authorName") || "").trim(),
    contact: (fd.get("contact") || "").trim(),
    password: fd.get("password") || "",
    content: (fd.get("content") || "").trim(),
    links,
    images: selectedImages,
    website: fd.get("website") || "",
  };

  btnSubmit.disabled = true;
  btnSubmit.textContent = "등록 중…";
  try {
    await callSubmitInquiry(payload);
    showView("list");
    loadList(1);
    showToast("문의가 등록되었습니다. 입력하신 비밀번호로 목록에서 열람하실 수 있습니다.");
  } catch (err) {
    formError.textContent = errorMessage(err, "등록 중 오류가 발생했습니다.");
    formError.hidden = false;
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "문의 등록";
  }
});

loadList(1);
