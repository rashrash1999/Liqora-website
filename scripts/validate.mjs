import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const errors = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.filter((entry) => !entry.name.startsWith(".") && entry.name !== "node_modules").map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

function localReference(value) {
  if (!value || /^(?:https?:|mailto:|tel:|data:|javascript:|#|\/\/)/i.test(value)) return null;
  return decodeURIComponent(value.split(/[?#]/)[0]);
}

const files = await walk(root);
const htmlFiles = files.filter((file) => extname(file) === ".html");

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  if (!/<html[^>]+lang=["']ar["']/i.test(html)) errors.push(`${file}: خاصية lang=ar مفقودة`);
  if (!/<html[^>]+dir=["']rtl["']/i.test(html)) errors.push(`${file}: خاصية dir=rtl مفقودة`);
  if (!/<title>[^<]+<\/title>/i.test(html)) errors.push(`${file}: عنوان الصفحة مفقود`);
  const references = [...html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)].map((match) => localReference(match[1])).filter(Boolean);
  for (const reference of references) {
    const target = resolve(dirname(file), reference);
    if (!target.startsWith(root)) {
      errors.push(`${file}: مرجع خارج المشروع ${reference}`);
      continue;
    }
    try { await access(target); } catch { errors.push(`${file}: ملف محلي مفقود ${reference}`); }
  }
}

for (const required of ["README.md", ".env.example", "index.html", "order.html", "checkout.html", "login.html", "admin-login.html", "dashboard.html", "admin.html", "invitation.html", "rsvp.html", "checkin.html"]) {
  try { await access(join(root, required)); } catch { errors.push(`ملف مطلوب مفقود: ${required}`); }
}

if (errors.length) {
  console.error(`فشل التحقق (${errors.length}):\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log(`نجح التحقق: ${htmlFiles.length} صفحات HTML وجميع المراجع المحلية سليمة.`);
