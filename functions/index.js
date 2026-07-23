const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const admin = require("firebase-admin");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

admin.initializeApp();
setGlobalOptions({ region: "asia-northeast3" });

const db = admin.firestore();
const bucket = admin.storage().bucket();

const MAX_TITLE = 100;
const MAX_NAME = 40;
const MAX_CONTACT = 100;
const MAX_CONTENT = 2000;
const MAX_LINKS = 3;
const MAX_LINK_LEN = 300;
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FAILED_ATTEMPTS = 10;
const MAX_ANSWER = 2000;
const ADMIN_UID = "5LM5VFGcQRU46C2XUWJmVma3Uco2";

function assertString(value, field, maxLen) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpsError("invalid-argument", `${field}이(가) 비어 있습니다.`);
  }
  if (value.length > maxLen) {
    throw new HttpsError("invalid-argument", `${field}이(가) 너무 깁니다.`);
  }
  return value.trim();
}

function maskName(name) {
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name[name.length - 1]}`;
}

function assertAdmin(request) {
  if (!request.auth || request.auth.uid !== ADMIN_UID) {
    throw new HttpsError("permission-denied", "관리자만 가능합니다.");
  }
}

function buildImageUrls(images) {
  return (images || []).map(
    (img) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(img.path)}?alt=media&token=${img.token}`
  );
}

function buildDetail(d, isAdmin) {
  return {
    title: d.title,
    authorName: d.authorName,
    contact: d.contact,
    content: d.content,
    links: d.links || [],
    imageUrls: buildImageUrls(d.images),
    status: d.status || "pending",
    answer: d.answer || "",
    createdAtMillis: d.createdAt ? d.createdAt.toMillis() : null,
    isAdmin,
  };
}

exports.submitInquiry = onCall(async (request) => {
  const data = request.data || {};

  if (typeof data.website === "string" && data.website.trim() !== "") {
    return { id: "ok" };
  }

  const title = assertString(data.title, "제목", MAX_TITLE);
  const authorName = assertString(data.authorName, "이름", MAX_NAME);
  const contact = assertString(data.contact, "연락처", MAX_CONTACT);
  const content = assertString(data.content, "문의 내용", MAX_CONTENT);

  const password = data.password;
  if (typeof password !== "string" || password.length < 4 || password.length > 30) {
    throw new HttpsError("invalid-argument", "비밀번호는 4~30자로 입력해주세요.");
  }

  const links = Array.isArray(data.links) ? data.links.filter((l) => typeof l === "string" && l.trim() !== "") : [];
  if (links.length > MAX_LINKS) {
    throw new HttpsError("invalid-argument", `링크는 최대 ${MAX_LINKS}개까지 가능합니다.`);
  }
  for (const link of links) {
    if (link.length > MAX_LINK_LEN || !/^https?:\/\//i.test(link)) {
      throw new HttpsError("invalid-argument", "링크는 http(s)로 시작하는 유효한 주소여야 합니다.");
    }
  }

  const images = Array.isArray(data.images) ? data.images : [];
  if (images.length > MAX_IMAGES) {
    throw new HttpsError("invalid-argument", `스크린샷은 최대 ${MAX_IMAGES}장까지 가능합니다.`);
  }
  const decodedImages = [];
  for (const img of images) {
    if (!img || typeof img.data !== "string" || !ALLOWED_IMAGE_TYPES.includes(img.contentType)) {
      throw new HttpsError("invalid-argument", "이미지 형식이 올바르지 않습니다.");
    }
    const buffer = Buffer.from(img.data, "base64");
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "이미지 용량은 3MB를 넘을 수 없습니다.");
    }
    decodedImages.push({ buffer, contentType: img.contentType });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const docRef = db.collection("inquiries").doc();

  const storedImages = [];
  for (let i = 0; i < decodedImages.length; i++) {
    const ext = decodedImages[i].contentType.split("/")[1];
    const path = `inquiries/${docRef.id}/${i}.${ext}`;
    const token = randomUUID();
    await bucket.file(path).save(decodedImages[i].buffer, {
      contentType: decodedImages[i].contentType,
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    storedImages.push({ path, token });
  }

  await docRef.set({
    title,
    authorName,
    contact,
    passwordHash,
    content,
    links,
    images: storedImages,
    status: "pending",
    answer: "",
    failedAttempts: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: docRef.id };
});

exports.listInquiries = onCall(async (request) => {
  const data = request.data || {};
  const pageSize = Math.min(Math.max(Number(data.pageSize) || 15, 1), 50);
  const page = Math.max(Number(data.page) || 1, 1);

  const query = db
    .collection("inquiries")
    .orderBy("createdAt", "desc")
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  const [snap, countSnap] = await Promise.all([
    query.get(),
    db.collection("inquiries").count().get(),
  ]);

  const items = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      title: d.title,
      authorName: maskName(d.authorName || ""),
      status: d.status || "pending",
      createdAtMillis: d.createdAt ? d.createdAt.toMillis() : null,
    };
  });

  return {
    items,
    total: countSnap.data().count,
    page,
    pageSize,
  };
});

exports.verifyInquiryPassword = onCall(async (request) => {
  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  const password = typeof data.password === "string" ? data.password : "";
  if (!id || !password) {
    throw new HttpsError("invalid-argument", "잘못된 요청입니다.");
  }

  const docRef = db.collection("inquiries").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "존재하지 않는 문의입니다.");
  }
  const d = doc.data();

  if ((d.failedAttempts || 0) >= MAX_FAILED_ATTEMPTS) {
    throw new HttpsError("resource-exhausted", "비밀번호 시도 횟수를 초과했습니다.");
  }

  const match = await bcrypt.compare(password, d.passwordHash);
  if (!match) {
    await docRef.update({ failedAttempts: admin.firestore.FieldValue.increment(1) });
    throw new HttpsError("permission-denied", "비밀번호가 일치하지 않습니다.");
  }

  if (d.failedAttempts) {
    await docRef.update({ failedAttempts: 0 });
  }

  return buildDetail(d, !!(request.auth && request.auth.uid === ADMIN_UID));
});

exports.adminGetInquiry = onCall(async (request) => {
  assertAdmin(request);

  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    throw new HttpsError("invalid-argument", "잘못된 요청입니다.");
  }

  const doc = await db.collection("inquiries").doc(id).get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "존재하지 않는 문의입니다.");
  }

  return buildDetail(doc.data(), true);
});

exports.deleteInquiry = onCall(async (request) => {
  assertAdmin(request);

  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    throw new HttpsError("invalid-argument", "잘못된 요청입니다.");
  }

  const docRef = db.collection("inquiries").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "존재하지 않는 문의입니다.");
  }

  const d = doc.data();
  await Promise.all((d.images || []).map((img) => bucket.file(img.path).delete({ ignoreNotFound: true })));
  await docRef.delete();

  return { ok: true };
});

exports.postAnswer = onCall(async (request) => {
  assertAdmin(request);

  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) {
    throw new HttpsError("invalid-argument", "잘못된 요청입니다.");
  }
  const answer = assertString(data.answer, "답변", MAX_ANSWER);

  const docRef = db.collection("inquiries").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) {
    throw new HttpsError("not-found", "존재하지 않는 문의입니다.");
  }

  await docRef.update({ answer, status: "answered" });
  return { ok: true };
});

// ---- Project showcase ----
const MAX_PROJECT_TITLE = 100;
const MAX_PROJECT_CAPTION = 200;
const MAX_PROJECT_IMAGES = 20;

function buildProjectImageUrl(img) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(img.path)}?alt=media&token=${img.token}`;
}

async function uploadProjectImages(docId, images, startIdx) {
  const stored = [];
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    if (!img || typeof img.data !== "string" || !ALLOWED_IMAGE_TYPES.includes(img.contentType)) {
      throw new HttpsError("invalid-argument", "이미지 형식이 올바르지 않습니다.");
    }
    const buffer = Buffer.from(img.data, "base64");
    if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new HttpsError("invalid-argument", "이미지 용량은 3MB를 넘을 수 없습니다.");
    }
    const ext = img.contentType.split("/")[1];
    const path = `projects/${docId}/${startIdx + i}.${ext}`;
    const token = randomUUID();
    await bucket.file(path).save(buffer, {
      contentType: img.contentType,
      resumable: false,
      metadata: { metadata: { firebaseStorageDownloadTokens: token } },
    });
    stored.push({
      path,
      token,
      caption: typeof img.caption === "string" ? img.caption.slice(0, MAX_PROJECT_CAPTION) : "",
      date: typeof img.date === "string" ? img.date.slice(0, 10) : "",
    });
  }
  return stored;
}

exports.createProject = onCall(async (request) => {
  assertAdmin(request);
  const data = request.data || {};

  const title = assertString(data.title, "제목", MAX_PROJECT_TITLE);
  const startDate = assertString(data.startDate, "의뢰일", 10);
  const endDate = typeof data.endDate === "string" ? data.endDate.trim().slice(0, 10) : "";
  const status = data.status === "완료" ? "완료" : "진행중";

  const images = Array.isArray(data.images) ? data.images : [];
  if (images.length > MAX_PROJECT_IMAGES) {
    throw new HttpsError("invalid-argument", `이미지는 최대 ${MAX_PROJECT_IMAGES}장까지 가능합니다.`);
  }

  const docRef = db.collection("projects").doc();
  const storedImages = await uploadProjectImages(docRef.id, images, 0);

  await docRef.set({
    title,
    startDate,
    endDate,
    status,
    images: storedImages,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { id: docRef.id };
});

exports.listProjects = onCall(async (request) => {
  const data = request.data || {};
  const pageSize = Math.min(Math.max(Number(data.pageSize) || 10, 1), 50);
  const page = Math.max(Number(data.page) || 1, 1);

  const query = db.collection("projects")
    .orderBy("createdAt", "desc")
    .offset((page - 1) * pageSize)
    .limit(pageSize);

  const [snap, countSnap] = await Promise.all([
    query.get(),
    db.collection("projects").count().get(),
  ]);

  const items = snap.docs.map((doc) => {
    const d = doc.data();
    const thumb = d.images && d.images.length > 0 ? d.images[0] : null;
    return {
      id: doc.id,
      title: d.title,
      startDate: d.startDate || "",
      endDate: d.endDate || "",
      status: d.status || "진행중",
      thumbnailUrl: thumb ? buildProjectImageUrl(thumb) : "",
      imageCount: (d.images || []).length,
    };
  });

  return { items, total: countSnap.data().count, page, pageSize };
});

exports.getProject = onCall(async (request) => {
  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new HttpsError("invalid-argument", "잘못된 요청입니다.");

  const doc = await db.collection("projects").doc(id).get();
  if (!doc.exists) throw new HttpsError("not-found", "존재하지 않는 프로젝트입니다.");

  const d = doc.data();
  return {
    title: d.title,
    startDate: d.startDate || "",
    endDate: d.endDate || "",
    status: d.status || "진행중",
    images: (d.images || []).map((img) => ({
      url: buildProjectImageUrl(img),
      caption: img.caption || "",
      date: img.date || "",
    })),
    isAdmin: !!(request.auth && request.auth.uid === ADMIN_UID),
  };
});

exports.updateProject = onCall(async (request) => {
  assertAdmin(request);
  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new HttpsError("invalid-argument", "잘못된 요청입니다.");

  const docRef = db.collection("projects").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "존재하지 않는 프로젝트입니다.");

  const d = doc.data();
  const updates = {};

  if (typeof data.title === "string") updates.title = data.title.trim().slice(0, MAX_PROJECT_TITLE);
  if (typeof data.startDate === "string") updates.startDate = data.startDate.trim().slice(0, 10);
  if (typeof data.endDate === "string") updates.endDate = data.endDate.trim().slice(0, 10);
  if (typeof data.status === "string") updates.status = data.status === "완료" ? "완료" : "진행중";

  const newImages = Array.isArray(data.newImages) ? data.newImages : [];
  const existing = d.images || [];

  if (existing.length + newImages.length > MAX_PROJECT_IMAGES) {
    throw new HttpsError("invalid-argument", `이미지는 최대 ${MAX_PROJECT_IMAGES}장까지 가능합니다.`);
  }

  if (newImages.length > 0) {
    const stored = await uploadProjectImages(id, newImages, existing.length);
    updates.images = [...existing, ...stored];
  }

  if (Object.keys(updates).length > 0) {
    await docRef.update(updates);
  }

  return { ok: true };
});

exports.deleteProject = onCall(async (request) => {
  assertAdmin(request);
  const data = request.data || {};
  const id = typeof data.id === "string" ? data.id : "";
  if (!id) throw new HttpsError("invalid-argument", "잘못된 요청입니다.");

  const docRef = db.collection("projects").doc(id);
  const doc = await docRef.get();
  if (!doc.exists) throw new HttpsError("not-found", "존재하지 않는 프로젝트입니다.");

  const d = doc.data();
  await Promise.all((d.images || []).map((img) => bucket.file(img.path).delete({ ignoreNotFound: true })));
  await docRef.delete();

  return { ok: true };
});
