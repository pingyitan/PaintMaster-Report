const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const HOST = "0.0.0.0";
const APP_DIR = __dirname;
const USERS_PATH = path.join(APP_DIR, "config", "users.json");
const SAMPLE_DATA_PATH = path.join(APP_DIR, "data", "staff_view_data.csv");
const REPORT_DATA_PATH = "C:\\Users\\admin\\Documents\\report\\staff_view_data.csv";
const LOCAL_STAFF_REPORT_DIR = "C:\\Users\\admin\\Documents\\report\\staff_view";
const CLOUD_STAFF_REPORT_DIR = process.env.REPORT_DIR || path.join(APP_DIR, "reports");
const STAFF_REPORT_DIR = process.env.REPORT_DIR ? CLOUD_STAFF_REPORT_DIR : LOCAL_STAFF_REPORT_DIR;
const UPLOAD_KEY = process.env.UPLOAD_KEY || "";
const PUBLIC_DIR = path.join(APP_DIR, "public");
const SESSION_COOKIE = "staff_session";
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const sessions = new Map();

function readUsers() {
  const raw = fs.readFileSync(USERS_PATH, "utf8");
  return JSON.parse(raw);
}

function getDataPath() {
  return fs.existsSync(REPORT_DATA_PATH) ? REPORT_DATA_PATH : SAMPLE_DATA_PATH;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  if (rows.length === 0) return [];
  const headers = rows[0].map((header) => header.trim());

  return rows.slice(1).filter((items) => items.some(Boolean)).map((items) => {
    const entry = {};
    headers.forEach((header, index) => {
      entry[header] = items[index] || "";
    });
    return entry;
  });
}

function readReportRows(user) {
  const text = fs.readFileSync(getDataPath(), "utf8");
  const rows = parseCsv(text);
  if (user.location === "ALL") return rows;
  return rows.filter((row) => String(row.Location || "").toUpperCase() === user.location);
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function createSession(user) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    username: user.username,
    expiresAt: Date.now() + SESSION_MAX_AGE_SECONDS * 1000
  });
  return token;
}

function getCookies(req) {
  const header = req.headers.cookie || "";
  return Object.fromEntries(header.split(";").map((part) => {
    const index = part.indexOf("=");
    if (index === -1) return ["", ""];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
  }).filter(([key]) => key));
}

function getCurrentUser(req) {
  const token = getCookies(req)[SESSION_COOKIE];
  if (!token || !sessions.has(token)) return null;

  const session = sessions.get(token);
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return readUsers().find((user) => user.username === session.username) || null;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(title, content, user = null) {
  const userLabel = user ? `${escapeHtml(user.name)} (${escapeHtml(user.location)})` : "";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/styles.css">
</head>
<body>
  <header class="topbar">
    <div>
      <div class="brand">Staff Location Viewer</div>
      ${user ? `<div class="user">${userLabel}</div>` : ""}
    </div>
    ${user ? `<a class="logout" href="/logout">Logout</a>` : ""}
  </header>
  <main>${content}</main>
</body>
</html>`;
}

function loginPage(message = "") {
  return page("Login", `
    <section class="login-panel">
      <h1>Login</h1>
      ${message ? `<div class="error">${escapeHtml(message)}</div>` : ""}
      <form method="post" action="/login">
        <label>
          Username
          <input name="username" autocomplete="username" required>
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit">Login</button>
      </form>
    </section>
  `);
}

function dashboardPage(user) {
  const reportLocations = user.location === "ALL" ? ["MB", "SA", "BA", "BR"] : [user.location];
  const reportCards = reportLocations.map((location) => {
    const pdfPath = path.join(STAFF_REPORT_DIR, `${location}.pdf`);
    const exists = fs.existsSync(pdfPath);
    return `
      <article class="report-card">
        <div class="report-card-header">
          <h2>${escapeHtml(location)}</h2>
          ${exists ? `<a class="button" href="/report/${location}" target="_blank">Open PDF</a>` : ""}
        </div>
        ${exists
          ? `<iframe title="${escapeHtml(location)} report" src="/report/${location}"></iframe>`
          : `<p class="missing">No report exported yet for ${escapeHtml(location)}. Run the Excel macro first.</p>`}
      </article>
    `;
  }).join("");

  return page("Dashboard", `
    <section class="summary">
      <div>
        <h1>${user.location === "ALL" ? "All Location Reports" : `${escapeHtml(user.location)} Report`}</h1>
        <p>Showing the latest exported report PDF from Excel.</p>
      </div>
    </section>
    <section class="reports">${reportCards}</section>
  `, user);
}

function dataTablePage(user) {
  let rows;
  let dataPath;
  try {
    rows = readReportRows(user);
    dataPath = getDataPath();
  } catch (error) {
    return page("Data Error", `
      <section class="notice">
        <h1>Data file problem</h1>
        <p>${escapeHtml(error.message)}</p>
      </section>
    `, user);
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : ["Date", "Weekday", "Work", "Location", "Month"];
  const visibleHeaders = headers.filter((header) => header.trim().length > 0);
  const bodyRows = rows.map((row) => `
    <tr class="${String(row.Work) === "0" ? "closed" : ""}">
      ${visibleHeaders.map((header) => `<td>${escapeHtml(row[header])}</td>`).join("")}
    </tr>
  `).join("");

  return page("Data Table", `
    <section class="summary">
      <div>
        <h1>${user.location === "ALL" ? "All Locations" : `${escapeHtml(user.location)} Location`}</h1>
        <p>${rows.length} rows loaded from ${escapeHtml(path.basename(dataPath))}</p>
      </div>
      <a class="button" href="/download">Download CSV</a>
    </section>
    <section class="table-wrap">
      <table>
        <thead>
          <tr>${visibleHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${bodyRows || `<tr><td colspan="${visibleHeaders.length}">No rows found for this location.</td></tr>`}</tbody>
      </table>
    </section>
  `, user);
}

function serveStatic(req, res, pathname) {
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname.replace("/public/", "")));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");
  if (!fs.existsSync(filePath)) return send(res, 404, "Not found");
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".css" ? "text/css; charset=utf-8" : "text/plain; charset=utf-8";
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(fs.readFileSync(filePath));
}

function getUploadLocation(pathname) {
  const requestedLocation = pathname.split("/").pop().toUpperCase();
  return ["MB", "SA", "BA", "BR"].includes(requestedLocation) ? requestedLocation : "";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Request is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname;
  const user = getCurrentUser(req);

  if (pathname.startsWith("/public/")) {
    serveStatic(req, res, pathname);
    return;
  }

  if (pathname.startsWith("/upload/") && req.method === "PUT") {
    const requestedLocation = getUploadLocation(pathname);
    const providedKey = req.headers["x-upload-key"] || "";

    if (!UPLOAD_KEY || providedKey !== UPLOAD_KEY) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid upload key.");
      return;
    }

    if (!requestedLocation) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid location.");
      return;
    }

    ensureDir(STAFF_REPORT_DIR);
    const destination = path.join(STAFF_REPORT_DIR, `${requestedLocation}.pdf`);
    const tempDestination = `${destination}.uploading`;
    const output = fs.createWriteStream(tempDestination);
    let bytes = 0;

    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 25 * 1024 * 1024) {
        output.destroy();
        req.destroy();
      }
    });

    req.pipe(output);
    output.on("finish", () => {
      fs.renameSync(tempDestination, destination);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Uploaded ${requestedLocation}.pdf`);
    });
    output.on("error", () => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Upload failed.");
    });
    return;
  }

  if (pathname === "/login" && req.method === "POST") {
    const body = await readRequestBody(req);
    const form = new URLSearchParams(body);
    const username = String(form.get("username") || "").trim().toLowerCase();
    const password = String(form.get("password") || "");
    const found = readUsers().find((candidate) =>
      candidate.username.toLowerCase() === username && candidate.password === password
    );

    if (!found) {
      send(res, 401, loginPage("Invalid username or password."));
      return;
    }

    const token = createSession(found);
    res.writeHead(302, {
      Location: "/",
      "Set-Cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/`
    });
    res.end();
    return;
  }

  if (pathname === "/logout") {
    const token = getCookies(req)[SESSION_COOKIE];
    if (token) sessions.delete(token);
    res.writeHead(302, {
      Location: "/login",
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/`
    });
    res.end();
    return;
  }

  if (pathname === "/login") {
    send(res, 200, loginPage());
    return;
  }

  if (!user) {
    redirect(res, "/login");
    return;
  }

  if (pathname === "/download") {
    const rows = readReportRows(user);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : ["Date", "Weekday", "Work", "Location", "Month"];
    const csv = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(","))
    ].join("\r\n");
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${user.location.toLowerCase()}_data.csv"`
    });
    res.end(csv);
    return;
  }

  if (pathname.startsWith("/report/")) {
    const requestedLocation = pathname.split("/").pop().toUpperCase();
    const allowed = user.location === "ALL" || user.location === requestedLocation;
    const valid = ["MB", "SA", "BA", "BR"].includes(requestedLocation);
    if (!valid || !allowed) {
      send(res, 403, page("Forbidden", `<section class="notice"><h1>Forbidden</h1></section>`, user));
      return;
    }

    const pdfPath = path.join(STAFF_REPORT_DIR, `${requestedLocation}.pdf`);
    if (!fs.existsSync(pdfPath)) {
      send(res, 404, page("Report Missing", `<section class="notice"><h1>Report missing</h1><p>Run the Excel macro to export ${escapeHtml(requestedLocation)}.pdf.</p></section>`, user));
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(pdfPath).pipe(res);
    return;
  }

  if (pathname === "/data") {
    send(res, 200, dataTablePage(user));
    return;
  }

  if (pathname === "/") {
    send(res, 200, dashboardPage(user));
    return;
  }

  send(res, 404, page("Not Found", `<section class="notice"><h1>Not found</h1></section>`, user));
});

function csvCell(value) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

server.listen(PORT, HOST, () => {
  console.log(`Staff Location Viewer running at http://localhost:${PORT}`);
  console.log(`Data file: ${getDataPath()}`);
});
