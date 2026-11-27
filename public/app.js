const state = {
  user: null,
  data: null,
  selectedSeasonId: null,
  tab: "games", // games | calendar | tasks | chains | stats | players | treasury | docs
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  showPastDeployed: false,
  gameFilter: "all", // all | mine | bounty
  chainFilterStatus: "all", // all | active | deployed | open_payment
  chainShowAllSlots: false,
  chainSearch: "",
  statsSort: "deployed", // deployed | earned | takeovers | handoffs
  statsSearch: "",
  satzungMarkdown: null,
  satzungUpdatedAt: null,
  satzungLoading: false,
  satzungError: null,
  satzungSearch: "",
  selectedPlayerIds: [],
  modal: null,
  error: null,
};

function esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatEuro(cents) {
  return ((cents || 0) / 100).toLocaleString("de-DE", {
    style: "currency",
    currency: "EUR",
  });
}

function buildPayPalUrl(rawHandleOrEmail, amountCents = null, noteOrRef = null) {
  if (!rawHandleOrEmail) return "";
  const cleaned = String(rawHandleOrEmail).trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const amountStr = amountCents !== null && amountCents !== undefined ? (amountCents / 100).toFixed(2) : "";
  const itemName = noteOrRef ? `RHTC Weitergabe ${noteOrRef}` : "RHTC Mannschaftskasse Weitergabegebuehr";

  // Falls es eine E-Mail-Adresse ist (enthält @): paypal.com/paypalme/ oder direkt PayPal Send Link
  if (cleaned.includes("@")) {
    const email = cleaned.toLowerCase();
    // https://www.paypal.com/cgi-bin/webscr?cmd=_xclick&business=...&amount=...&currency_code=EUR&item_name=...
    const params = new URLSearchParams({
      cmd: "_xclick",
      business: email,
      currency_code: "EUR",
      item_name: itemName,
    });
    if (amountStr) params.set("amount", amountStr);
    return `https://www.paypal.com/cgi-bin/webscr?${params.toString()}`;
  }

  // Falls es paypal.me/Name oder nur Name ist
  let mePath = cleaned;
  if (!mePath.toLowerCase().startsWith("paypal.me/")) {
    mePath = `paypal.me/${mePath.replace(/^\/+/, "")}`;
  }
  return `https://${mePath}${amountStr ? `/${amountStr}` : ""}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fullName(u) {
  return u ? `${u.first_name} ${u.last_name}` : "Offen";
}

function getRemainingOpenCents(ev) {
  if (!ev) return 0;
  return Math.max(
    0,
    (ev.fee_total_cents || 0) - (ev.waived_amount_cents || 0) - (ev.credit_offset_cents || 0)
  );
}

function roleLabel(role) {
  const map = {
    PLAYER: "Spieler",
    SCHIEDSRICHTERWART: "Schiedsrichterwart",
    KASSENWART: "Mannschaftskassenwart",
    VORSTAND: "Vorstand",
    ADMIN: "Admin",
  };
  return map[role] || role;
}

function canViewAdminTabs(user) {
  return ["SCHIEDSRICHTERWART", "KASSENWART", "VORSTAND", "ADMIN"].includes(
    user?.role
  );
}

function statusBadge(status) {
  const map = {
    UNASSIGNED: ["Offen", "badge-red"],
    ASSIGNED: ["Zugewiesen (unbestätigt)", "badge-amber"],
    PENDING_HANDOFF: ["Weitergeleitet (unbestätigt)", "badge-amber"],
    CONFIRMED: ["Ansetzung zugesagt", "badge-blue"],
    VOLUNTARY_REQUESTED: ["Übernahme angefragt", "badge-amber"],
    REPORTED_DEPLOYED: ["Gepfiffen (gemeldet)", "badge-amber"],
    CONFIRMED_DEPLOYED: ["Gepfiffen & bestätigt (§ 6.1)", "badge-green"],
  };
  const [label, cls] = map[status] || [status, "badge-gray"];
  return `<span class="badge ${cls}">${label}</span>`;
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || "Anfrage fehlgeschlagen");
  }
  return json;
}

async function loadDashboard() {
  try {
    const qs = state.selectedSeasonId !== null && state.selectedSeasonId !== undefined
      ? `?seasonId=${state.selectedSeasonId}`
      : "";
    const data = await api(`/api/dashboard${qs}`);
    state.user = data.user;
    state.data = data;
    if (state.data?.season && state.selectedSeasonId === null) {
      state.selectedSeasonId = state.data.season.id;
    }
    state.error = null;
  } catch (e) {
    if (e.message && (e.message.includes("Nicht angemeldet") || e.message.includes("401"))) {
      state.user = null;
      state.data = null;
      state.error = null;
    } else {
      state.error = e.message;
    }
  }
  render();
}

function showChatModal(title, chatMessage) {
  state.modal = {
    type: "chat",
    title,
    chatMessage,
  };
  render();
}

function openHandoffModal(chain, game) {
  const diffHours = (new Date(game.kickoff_at).getTime() - Date.now()) / 3600000;
  state.modal = {
    type: "handoff",
    chain,
    game,
    isShortNotice: diffHours < 48,
  };
  render();
}

function openAddGameModal() {
  state.modal = { type: "addGame" };
  render();
}

function openEditGameModal(gameId) {
  const game = state.data?.games?.find((g) => g.id === gameId);
  if (!game) return;
  state.modal = { type: "editGame", game };
  render();
}

function openManualAssignModal(chainId) {
  if (!state.data?.games) return;
  for (const g of state.data.games) {
    const ch = g.chains?.find((c) => c.id === chainId);
    if (ch) {
      state.modal = { type: "manualAssign", chain: ch, game: g };
      render();
      return;
    }
  }
}

function openAddPlayerModal() {
  state.modal = { type: "addPlayer" };
  render();
}

function openImportCsvModal() {
  state.modal = { type: "importCsv", parsedRows: [], fileName: "", result: null };
  render();
}

function openImportGamesCsvModal() {
  state.modal = { type: "importGamesCsv", parsedRows: [], fileName: "", result: null };
  render();
}

function openAddSeasonModal() {
  state.modal = { type: "addSeason" };
  render();
}

function openEditSeasonModal() {
  const currentSeason =
    state.data?.season ||
    state.data?.seasons?.find((s) => s.id === state.selectedSeasonId) ||
    state.data?.seasons?.[0];
  if (!currentSeason) {
    alert("Keine Saison zum Bearbeiten vorhanden.");
    return;
  }
  state.modal = { type: "editSeason", season: currentSeason };
  render();
}

function openProfileModal() {
  state.modal = { type: "profile" };
  render();
}

function openEditPlayerModal(playerId) {
  const player = state.data?.players?.find((p) => p.id === playerId);
  if (!player) return;
  state.modal = { type: "editPlayer", player };
  render();
}

function openHardshipModal(ev) {
  state.modal = { type: "hardship", ev };
  render();
}

function closeModal() {
  state.modal = null;
  render();
}

const RHTC_CREST_SVG = `<img src="https://rhtc.de/wp-content/uploads/2022/04/RHTC-Logo-ohne-Punkte-weisser-Kreisrand.png" alt="RHTC Logo" class="brand-logo" />`;

const EYE_OPEN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_OFF_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

window.togglePasswordVisibility = (inputId, btn) => {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPass = input.type === "password";
  input.type = isPass ? "text" : "password";
  if (btn) {
    btn.innerHTML = isPass ? EYE_OFF_SVG : EYE_OPEN_SVG;
    btn.setAttribute("title", isPass ? "Passwort verbergen" : "Passwort anzeigen");
  }
};

function renderLogin() {
  return `
    <div class="login-wrap">
      <div class="login-brand">
        <div class="brand-crest">${RHTC_CREST_SVG}</div>
        <div>
          <div style="font-weight:800;font-size:1.1rem">Schiri-Ansetzungen</div>
        </div>
      </div>
      <div class="card login-card">
        <p style="color:var(--muted);font-size:0.9rem;margin-top:0">
          Anmeldung für Spieler, Schiedsrichterwart, Mannschaftskassenwart und Vorstand gemäß Satzung.
        </p>
        ${state.error ? `<div class="alert alert-danger">${esc(state.error)}</div>` : ""}
        <form id="login-form">
          <div class="form-group">
            <label>E-Mail</label>
            <input type="email" id="login-email" required placeholder="z. B. albers@rhtc.de" autocomplete="username" />
          </div>
          <div class="form-group">
            <label>Passwort</label>
            <div class="password-wrap">
              <input type="password" id="login-password" required placeholder="Passwort eingeben" autocomplete="current-password" />
              <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('login-password', this)" title="Passwort anzeigen">
                ${EYE_OPEN_SVG}
              </button>
            </div>
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center;margin-top:6px">Anmelden</button>
        </form>
        <p style="font-size:0.8rem;color:var(--muted);text-align:center;margin-top:16px;margin-bottom:0">
          Passwort vergessen? Bitte wende dich an deinen Schiedsrichterwart.
        </p>
      </div>
    </div>
  `;
}

function canVolunteerForChain(chain) {
  if (chain.status !== "ASSIGNED" && chain.status !== "PENDING_HANDOFF") {
    return false;
  }
  const responsibleId = chain.pending_assignee_id ?? chain.current_assignee_id;
  return responsibleId !== state.user.id;
}

function isPastDeployedGame(game) {
  const isPast = new Date(game.kickoff_at).getTime() < Date.now();
  const allDeployed =
    game.chains.length > 0 &&
    game.chains.every((c) => c.status === "CONFIRMED_DEPLOYED");
  return isPast && allDeployed;
}

function renderChainSteps(ch) {
  if (!ch.events || ch.events.length === 0) return "";
  const ascEvents = [...ch.events].sort((a, b) => a.id - b.id);
  const steps = [];
  for (const ev of ascEvents) {
    if (ev.event_type === "INITIAL_ASSIGNMENT" && ev.toUser) {
      steps.push({ label: ev.toUser.last_name, paid: "" });
    } else if (
      (ev.event_type === "REGULAR_HANDOFF" || ev.event_type === "SQUAD_NOMINATION") &&
      ev.toUser
    ) {
      if (steps.length > 0 && ev.fee_total_cents > 0) {
        steps[steps.length - 1].paid = ` (${formatEuro(ev.fee_total_cents)})`;
      } else if (steps.length > 0 && ev.reason_type === "SQUAD_NOMINATION") {
        steps[steps.length - 1].paid = " (Kader)";
      } else if (steps.length > 0 && ev.reason_type === "VOLUNTEER_EXEMPT") {
        steps[steps.length - 1].paid = " (§7)";
      }
      steps.push({ label: ev.toUser.last_name, paid: "" });
    } else if (ev.event_type === "VOLUNTEER_APPROVED" && ev.toUser) {
      steps.push({ label: `${ev.toUser.last_name} (Übernahme)`, paid: "" });
    }
  }
  if (steps.length <= 1) return "";
  return `
    <div class="chain-steps" title="Weitergabestrang">
      <span style="color:var(--muted);font-weight:600">Strang:</span>
      ${steps
        .map((s, i) => {
          const isLast = i === steps.length - 1;
          return `<span class="chain-step ${isLast ? "current" : ""}">${esc(s.label)}${esc(s.paid)}</span>${isLast ? "" : `<span class="chain-arrow">&rarr;</span>`}`;
        })
        .join("")}
    </div>
  `;
}

function renderGamesTab() {
  const isWart =
    state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN";
  const allGames = state.data.games;
  const hiddenCount = allGames.filter(isPastDeployedGame).length;
  let games = state.showPastDeployed
    ? allGames
    : allGames.filter((g) => !isPastDeployedGame(g));

  // Sort games by kickoff time ascending
  games = [...games].sort((a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime());

  // Offene Prämien-Spiele (unbestätigt & Topf > 0 €)
  const bountySlots = [];
  for (const g of games) {
    for (const ch of g.chains) {
      if (
        ch.payout_pool_cents > 0 &&
        (ch.status === "ASSIGNED" || ch.status === "PENDING_HANDOFF")
      ) {
        bountySlots.push({ g, ch });
      }
    }
  }

  if (state.gameFilter === "mine") {
    games = games.filter((g) =>
      g.chains.some(
        (c) => (c.pending_assignee_id ?? c.current_assignee_id) === state.user.id
      )
    );
  } else if (state.gameFilter === "bounty") {
    games = games.filter((g) => g.chains.some((c) => c.payout_pool_cents > 0));
  }

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:1.1rem">Schiri-Ansetzungen</h2>
      <div class="btn-row" style="margin:0">
        ${
          hiddenCount > 0
            ? `<button class="btn btn-outline btn-sm" onclick="togglePastDeployed()">${state.showPastDeployed ? "Vergangene eingesetzte ausblenden" : `Vergangene eingesetzte anzeigen (${hiddenCount})`}</button>`
            : ""
        }
        ${isWart ? `<button class="btn btn-outline btn-sm" onclick="openImportGamesCsvModal()">Spielplan-CSV</button>` : ""}
        ${isWart ? `<button class="btn btn-primary btn-sm" onclick="openAddGameModal()">+ Neues Spiel ansetzen</button>` : ""}
      </div>
    </div>
  `;

  if (bountySlots.length > 0) {
    html += `
      <div class="bounty-banner">
        <div class="bounty-banner-header">
          <div class="bounty-banner-title">Offene Übernahme-Prämien (Finanzieller Topf)</div>
          <span class="bounty-count-badge">${bountySlots.length} ${bountySlots.length === 1 ? "offener Topf" : "offene Töpfe"}</span>
        </div>
        <div class="bounty-list">
          ${bountySlots
            .map(({ g, ch }) => {
              const canTake = canVolunteerForChain(ch);
              return `
                <div class="bounty-item-wrap">
                  <article class="bounty-item">
                    <div class="bounty-item-info">
                      <div class="bounty-item-title">${esc(g.title)}</div>
                      <div class="bounty-item-meta">${formatDate(g.kickoff_at)} &bull; ${esc(ch.ref_code || `Slot ${ch.slot_number}`)}</div>
                    </div>
                    <div class="bounty-item-actions">
                      <span class="bounty-amount">+${formatEuro(ch.payout_pool_cents)}</span>
                      ${
                        canTake
                          ? `<button class="btn btn-warn btn-sm" onclick="requestVolunteer(${ch.id})">Übernehmen</button>`
                          : ""
                      }
                    </div>
                  </article>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  html += `
    <div class="filter-bar">
      <button class="filter-pill ${state.gameFilter === "all" ? "active" : ""}" onclick="setGameFilter('all')">Alle Spiele</button>
      <button class="filter-pill ${state.gameFilter === "mine" ? "active" : ""}" onclick="setGameFilter('mine')">Meine Spiele</button>
      <button class="filter-pill ${state.gameFilter === "bounty" ? "active" : ""}" onclick="setGameFilter('bounty')">Mit Topf-Prämie (${bountySlots.length})</button>
    </div>
  `;

  if (games.length === 0) {
    html += `<div class="card" style="text-align:center;color:var(--muted);padding:30px">Keine Spiele für die aktuelle Auswahl gefunden.</div>`;
    return html;
  }

  const WEEKDAYS = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
  const MONTHS_SHORT = ["JAN", "FEB", "MÄR", "APR", "MAI", "JUN", "JUL", "AUG", "SEP", "OKT", "NOV", "DEZ"];
  const MONTHS_LONG = [
    "JANUAR", "FEBRUAR", "MÄRZ", "APRIL", "MAI", "JUNI",
    "JULI", "AUGUST", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DEZEMBER"
  ];

  // Group by month
  const monthGroups = new Map();
  for (const g of games) {
    const d = new Date(g.kickoff_at);
    const key = `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
    if (!monthGroups.has(key)) {
      monthGroups.set(key, []);
    }
    monthGroups.get(key).push(g);
  }

  const pad = (n) => String(n).padStart(2, "0");

  for (const [monthKey, monthGames] of monthGroups) {
    html += `<div class="month-header">${monthKey}</div>`;

    for (const game of monthGames) {
      const d = new Date(game.kickoff_at);
      const weekday = WEEKDAYS[d.getDay()];
      const dayNum = `${pad(d.getDate())}.`;
      const monthShort = MONTHS_SHORT[d.getMonth()];
      const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

      // Relative day label
      const now = new Date();
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const targetMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const diffDays = Math.round((targetMidnight - todayMidnight) / 86400000);
      let relativeStr = "";
      if (diffDays === 0) relativeStr = "heute";
      else if (diffDays === 1) relativeStr = "morgen";
      else if (diffDays === 2) relativeStr = "in 2 Tagen";
      else if (diffDays > 2) relativeStr = `in ${diffDays} Tagen`;
      else if (diffDays === -1) relativeStr = "gestern";
      else if (diffDays < -1) relativeStr = `vor ${Math.abs(diffDays)} Tagen`;

      // Pot total
      const totalPot = game.chains.reduce((acc, c) => acc + (c.payout_pool_cents || 0), 0);

      // Eigener aktiver Slot des angemeldeten Nutzers in diesem Spiel
      const myGameChain = game.chains.find(
        (c) =>
          (c.pending_assignee_id ?? c.current_assignee_id) === state.user.id &&
          c.status !== "CONFIRMED_DEPLOYED" &&
          c.status !== "REPORTED_DEPLOYED"
      );

      const gameMenuPlayItems = [];
      if (myGameChain) {
        gameMenuPlayItems.push(
          `<button class="menu-item" onclick="downloadGameIcs(${myGameChain.id})">📅 In Kalender eintragen (.ics)</button>`
        );
      }
      if (isWart || myGameChain) {
        gameMenuPlayItems.push(
          `<button class="menu-item" onclick="copyGameWhatsAppInfo(${game.id})">💬 Spiel-Info für WhatsApp kopieren</button>`
        );
      }
      if (isWart) {
        gameMenuPlayItems.push(
          `<button class="menu-item" onclick="openUrgentBroadcastModal(${game.id})" style="color:var(--danger);font-weight:600">🚨 Dringenden Übernahme-Aufruf teilen</button>`
        );
      }

      const showGameMenu = gameMenuPlayItems.length > 0 || isWart;

      html += `
        <div class="game-card">
          <div class="game-date-badge">
            <span class="date-badge-weekday">${weekday}</span>
            <span class="date-badge-day">${dayNum}</span>
            <span class="date-badge-month">${monthShort}</span>
            <span class="date-badge-relative">${relativeStr}</span>
          </div>

          <div class="game-card-content">
            <div class="game-card-header">
              <div class="game-time-location">
                <span class="game-time">${timeStr}</span>
                <span class="game-location">📍 ${esc(game.location || "RHTC")}</span>
              </div>
              ${
                showGameMenu
                  ? `
                    <div class="game-options-wrap">
                      <button class="game-options-btn" onclick="toggleGameMenu(event, ${game.id})" title="Optionen">···</button>
                      <div class="slot-dropdown-menu" id="game-menu-${game.id}">
                        ${
                          gameMenuPlayItems.length > 0
                            ? `<div class="menu-section-header">SPIEL</div>${gameMenuPlayItems.join("")}`
                            : ""
                        }
                        ${
                          isWart
                            ? `
                              <div class="menu-section-header">ADMIN</div>
                              <button class="menu-item" onclick="openEditGameModal(${game.id})">✏️ Spiel bearbeiten</button>
                              <button class="menu-item text-danger" onclick="deleteGame(${game.id}, '${esc(game.title)}')">🗑️ Spiel löschen</button>
                            `
                            : ""
                        }
                      </div>
                    </div>
                  `
                  : ""
              }
            </div>

            <div class="game-subtitle-row">
              <span class="game-title">${esc(game.title)}</span>
              ${game.is_first_game_of_season ? `<span class="game-tag">1. Saisonspiel (§ 3 Abs. 3)</span>` : ""}
            </div>

            <div class="game-slots-grid">
      `;

      for (const ch of game.chains) {
        const responsibleId = ch.pending_assignee_id ?? ch.current_assignee_id;
        const isResponsible = responsibleId === state.user.id;
        const isUnconfirmed = ch.status === "ASSIGNED" || ch.status === "PENDING_HANDOFF";
        const assignee = ch.pendingAssignee || ch.currentAssignee;
        const refName = assignee ? `${esc(fullName(assignee))}${isResponsible ? " (Du)" : ""}` : "Noch niemand";

        // Status pill – klare visuelle & sprachliche Trennung zwischen Vorab-Zusage und gepfiffenem Einsatz (§ 6.1)
        let statusPill = "";
        if (ch.status === "CONFIRMED_DEPLOYED") {
          statusPill = `<span class="slot-status-pill status-deployed" title="Spiel tatsächlich gepfiffen und vom Schiedsrichterwart nach § 6 Abs. 1 offiziell bestätigt (zählt als Einsatz nach § 1 Abs. 4)"><span class="status-icon" aria-hidden="true">✓✓</span> Gepfiffen &amp; bestätigt (§ 6.1)</span>`;
        } else if (ch.status === "REPORTED_DEPLOYED") {
          statusPill = `<span class="slot-status-pill status-reported" title="Vom Schiedsrichter als gepfiffen gemeldet (§ 6.2) – wartet auf Bestätigung durch den Schiedsrichterwart"><span class="status-icon" aria-hidden="true">⏱</span> Gepfiffen (gemeldet)</span>`;
        } else if (ch.status === "CONFIRMED") {
          statusPill = `<span class="slot-status-pill status-confirmed" title="Schiedsrichter hat die Ansetzung vorab angenommen – Spiel steht noch bevor (§ 1 Abs. 3)"><span class="status-icon" aria-hidden="true">📅</span> Ansetzung zugesagt</span>`;
        } else if (ch.status === "VOLUNTARY_REQUESTED") {
          statusPill = `<span class="slot-status-pill status-unconfirmed" title="Freiwillige Übernahme angefragt – wartet auf Zustimmung (§ 5 Abs. 2)"><span class="status-dot" aria-hidden="true"></span> Übernahme angefragt</span>`;
        } else if (!assignee) {
          statusPill = `<span class="slot-status-pill status-unassigned" title="Diesem Slot ist noch kein Schiedsrichter zugewiesen"><span class="status-dot" aria-hidden="true"></span> Unbesetzt</span>`;
        } else {
          statusPill = `<span class="slot-status-pill status-unconfirmed" title="Wartet noch auf Annahme durch den angesetzten Schiedsrichter"><span class="status-dot" aria-hidden="true"></span> Unbestätigt</span>`;
        }

        const isCompletedSlot =
          ch.status === "CONFIRMED_DEPLOYED" || ch.status === "REPORTED_DEPLOYED";
        const isKickoffReached = new Date(game.kickoff_at).getTime() <= Date.now();
        const canReportDeployed =
          (isResponsible || isWart) &&
          Boolean(assignee) &&
          !isCompletedSlot &&
          (isKickoffReached || isWart);

        // Aktionen für Dropdown-Menü vorbereiten
        const ansetzungItems = [];
        if ((isResponsible || isWart) && isUnconfirmed) {
          ansetzungItems.push(`<button class="menu-item" onclick="respondHandoff(${ch.id}, 'ACCEPT')">Annehmen (bestätigen)</button>`);
        }
        if ((isResponsible || isWart) && assignee && !isCompletedSlot) {
          ansetzungItems.push(`<button class="menu-item" onclick="handoffById(${ch.id})">Weiterleiten ...</button>`);
        }
        // "In Kalender eintragen" nur für eigene Spiele, die man selbst pfeift
        if (isResponsible && !isCompletedSlot) {
          ansetzungItems.push(`<button class="menu-item" onclick="downloadGameIcs(${ch.id})">📅 In Kalender eintragen</button>`);
        }
        // "Schiri-Erinnerung senden" & "Rückbestätigung anfordern" nur für Schiedsrichterwart und Admin
        if (isWart && assignee && !isCompletedSlot) {
          ansetzungItems.push(`<button class="menu-item" onclick="openGameReminderModal(${game.id}, ${ch.id})">💬 Schiri-Erinnerung senden</button>`);
        }
        if (isWart && assignee && isUnconfirmed) {
          ansetzungItems.push(`<button class="menu-item" onclick="openConfirmationReminderModal(${game.id}, ${ch.id})" style="color:var(--warn)">⏰ Rückbestätigung anfordern</button>`);
        }
        if (canVolunteerForChain(ch)) {
          ansetzungItems.push(`<button class="menu-item" onclick="requestVolunteer(${ch.id})">${ch.payout_pool_cents > 0 ? `Unbestätigtes Spiel übernehmen (+${formatEuro(ch.payout_pool_cents)})` : "Unbestätigtes Spiel übernehmen"}</button>`);
        }
        if ((isResponsible || isWart) && ch.status === "VOLUNTARY_REQUESTED") {
          ansetzungItems.push(`<button class="menu-item" onclick="decideVolunteer(${ch.id}, 'APPROVE')">Übernahme bestätigen</button>`);
          ansetzungItems.push(`<button class="menu-item text-danger" onclick="decideVolunteer(${ch.id}, 'REJECT')">Übernahme ablehnen (selbst pfeifen)</button>`);
        }

        const nachDemSpielItems = [];
        if (isWart && (ch.status === "REPORTED_DEPLOYED" || ch.status === "CONFIRMED" || ch.status === "ASSIGNED")) {
          nachDemSpielItems.push(`<button class="menu-item" onclick="confirmDeployed(${ch.id})">Einsatz bestätigen (§ 6.1)</button>`);
        }
        if (canReportDeployed) {
          nachDemSpielItems.push(`<button class="menu-item" onclick="reportDeployed(${ch.id})">Als gepfiffen melden (§ 6.2)</button>`);
        }

        const adminItems = [];
        if (isWart && ch.status !== "CONFIRMED_DEPLOYED") {
          adminItems.push(`<button class="menu-item" onclick="openManualAssignModal(${ch.id})">Manuell zuweisen ...</button>`);
        }

        const totalMenuItems =
          ansetzungItems.length + nachDemSpielItems.length + adminItems.length;

        // Primary action determination (nur wenn tatsächlich eine Aktion möglich ist)
        let primaryClick = "";
        let primaryText = "";
        let hasDirectPrimary = true;
        if ((isResponsible || isWart) && ch.status === "VOLUNTARY_REQUESTED") {
          primaryClick = `decideVolunteer(${ch.id}, 'APPROVE')`;
          primaryText = "Übernahme bestätigen";
        } else if ((isResponsible || isWart) && isUnconfirmed) {
          primaryClick = `respondHandoff(${ch.id}, 'ACCEPT')`;
          primaryText = "Annehmen";
        } else if (isResponsible && ch.status === "CONFIRMED" && isKickoffReached) {
          primaryClick = `reportDeployed(${ch.id})`;
          primaryText = "Als gepfiffen melden";
        } else if ((isResponsible || isWart) && ch.status === "CONFIRMED") {
          primaryClick = `handoffById(${ch.id})`;
          primaryText = "Weiterleiten";
        } else if (isWart && ch.status === "REPORTED_DEPLOYED") {
          primaryClick = `confirmDeployed(${ch.id})`;
          primaryText = "Einsatz bestätigen";
        } else if (canVolunteerForChain(ch)) {
          primaryClick = `requestVolunteer(${ch.id})`;
          primaryText = ch.payout_pool_cents > 0 ? `Übernehmen (+${formatEuro(ch.payout_pool_cents)})` : "Übernehmen";
        } else if (!assignee && isWart) {
          primaryClick = `openManualAssignModal(${ch.id})`;
          primaryText = "Zuweisen";
        } else if (totalMenuItems > 0) {
          hasDirectPrimary = false;
          primaryClick = `toggleSlotDropdown(event, ${ch.id})`;
          primaryText = "Aktionen";
        } else {
          hasDirectPrimary = false;
        }

        let dropdownContent = "";
        if (ansetzungItems.length > 0) {
          dropdownContent += `<div class="menu-section-header">ANSETZUNG</div>${ansetzungItems.join("")}`;
        }
        if (nachDemSpielItems.length > 0) {
          dropdownContent += `<div class="menu-section-header">NACH DEM SPIEL</div>${nachDemSpielItems.join("")}`;
        }
        if (adminItems.length > 0) {
          dropdownContent += `<div class="menu-section-header">ADMIN</div>${adminItems.join("")}`;
        }

        const showSlotActionButton = hasDirectPrimary || totalMenuItems > 0;
        const showSlotDropdown =
          totalMenuItems > 1 || (!hasDirectPrimary && totalMenuItems === 1);

        html += `
          <div class="ref-slot-card ${ch.payout_pool_cents > 0 ? "has-pot" : ""}">
            <div class="ref-slot-info">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;flex-wrap:wrap">
                <span class="ref-slot-code">Schiri ${ch.slot_number} · ${esc(ch.ref_code || `SR-00${ch.slot_number}`)}</span>
                ${ch.payout_pool_cents > 0 ? `<span class="slot-pot-badge" title="Weiterleitungstopf / Übernahme-Prämie für diesen Slot">+${formatEuro(ch.payout_pool_cents)} Topf</span>` : ""}
              </div>
              <div class="ref-slot-name">${refName}</div>
              ${statusPill}
              ${ch.voluntaryRequester ? `<div style="font-size:0.75rem;color:var(--warn);margin-top:2px">Übernahme durch ${esc(fullName(ch.voluntaryRequester))} angefragt</div>` : ""}
            </div>

            ${
              showSlotActionButton
                ? `
                  <div class="slot-split-btn-group">
                    <button class="slot-primary-btn ${showSlotDropdown ? "" : "slot-single-btn"}" onclick="${primaryClick}">${primaryText}</button>
                    ${
                      showSlotDropdown
                        ? `
                          <button class="slot-dropdown-toggle" onclick="toggleSlotDropdown(event, ${ch.id})" title="Weitere Aktionen">▾</button>
                          <div class="slot-dropdown-menu" id="slot-menu-${ch.id}">
                            ${dropdownContent}
                          </div>
                        `
                        : ""
                    }
                  </div>
                `
                : ""
            }
          </div>
        `;
      }

      html += `
            </div>
          </div>
        </div>
      `;
    }
  }

  return html;
}

function renderCalendarTab() {
  const year = state.calendarYear;
  const month = state.calendarMonth;
  const monthStart = new Date(year, month, 1);
  const monthLabel = monthStart.toLocaleDateString("de-DE", {
    month: "long",
    year: "numeric",
  });

  // Montag als erster Wochentag (0=Mo .. 6=So)
  const startDow = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((startDow + daysInMonth) / 7) * 7;

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;

  const gamesByDay = new Map();
  const monthGames = [];
  for (const g of state.data.games) {
    const d = new Date(g.kickoff_at);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!gamesByDay.has(key)) gamesByDay.set(key, []);
    gamesByDay.get(key).push(g);
    if (d.getFullYear() === year && d.getMonth() === month) {
      monthGames.push(g);
    }
  }

  let cellsHtml = "";
  for (let i = 0; i < totalCells; i++) {
    let cellYear = year;
    let cellMonth = month;
    let dayNum = i - startDow + 1;
    let isOther = false;

    if (dayNum <= 0) {
      isOther = true;
      cellMonth = month - 1;
      if (cellMonth < 0) {
        cellMonth = 11;
        cellYear -= 1;
      }
      dayNum = prevMonthDays + dayNum;
    } else if (dayNum > daysInMonth) {
      isOther = true;
      cellMonth = month + 1;
      if (cellMonth > 11) {
        cellMonth = 0;
        cellYear += 1;
      }
      dayNum = dayNum - daysInMonth;
    }

    const key = `${cellYear}-${cellMonth}-${dayNum}`;
    const isToday = key === todayKey;
    const dayGames = gamesByDay.get(key) || [];

    const eventsHtml = dayGames
      .map((g) => {
        const timeStr = new Date(g.kickoff_at).toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const isMine = g.chains.some(
          (c) => (c.pending_assignee_id ?? c.current_assignee_id) === state.user.id
        );
        const refs = g.chains
          .map((c) => {
            const p = c.pendingAssignee || c.currentAssignee;
            return p ? `${c.slot_number}: ${esc(p.last_name)}` : `${c.slot_number}: Offen`;
          })
          .join(" &bull; ");
        return `
          <div class="cal-event ${isMine ? "mine" : ""}" onclick="setTab('games')" title="${esc(g.title)}">
            <div class="cal-event-title">${timeStr} ${esc(g.title)}</div>
            <div class="cal-event-refs">${refs}</div>
          </div>
        `;
      })
      .join("");

    cellsHtml += `
      <div class="cal-cell ${isOther ? "other-month" : ""} ${isToday ? "today" : ""}">
        <div class="cal-day-num">${dayNum}</div>
        ${eventsHtml}
      </div>
    `;
  }

  const sortedMonthGames = [...monthGames].sort(
    (a, b) => new Date(a.kickoff_at).getTime() - new Date(b.kickoff_at).getTime()
  );
  const agendaGroups = new Map();
  for (const g of sortedMonthGames) {
    const d = new Date(g.kickoff_at);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (!agendaGroups.has(dayKey)) {
      agendaGroups.set(dayKey, {
        label: d.toLocaleDateString("de-DE", {
          weekday: "short",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
        games: [],
      });
    }
    agendaGroups.get(dayKey).games.push(g);
  }
  const agendaHtml =
    agendaGroups.size === 0
      ? `<p style="color:var(--muted);margin:0">Keine Hallenspiele in diesem Monat eingetragen.</p>`
      : Array.from(agendaGroups.values())
          .map(
            (group) => `
          <div class="cal-agenda-day">
            <div class="cal-agenda-date">${esc(group.label)}</div>
            <div class="cal-agenda-list">
              ${group.games
                .map((g) => {
                  const timeStr = new Date(g.kickoff_at).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const isMine = g.chains.some(
                    (c) => (c.pending_assignee_id ?? c.current_assignee_id) === state.user.id
                  );
                  const refs = g.chains
                    .map((c) => {
                      const p = c.pendingAssignee || c.currentAssignee;
                      return p ? `Slot ${c.slot_number}: ${esc(p.last_name)}` : `Slot ${c.slot_number}: Offen`;
                    })
                    .join(" &bull; ");
                  return `
                    <div class="cal-agenda-event ${isMine ? "mine" : ""}" onclick="setTab('games')">
                      <div class="cal-agenda-title">${timeStr} &bull; ${esc(g.title)}</div>
                      <div class="cal-agenda-meta">${esc(g.location || "RHTC Halle")} &bull; ${refs}</div>
                    </div>
                  `;
                })
                .join("")}
            </div>
          </div>
        `
          )
          .join("");

  return `
    <div class="card">
      <div class="cal-header">
        <h2 style="margin:0;font-size:1.1rem">Kalendarische Übersicht – ${esc(monthLabel)}</h2>
        <div class="btn-row" style="margin:0">
          <button class="btn btn-outline btn-sm" onclick="shiftCalendarMonth(-1)">&larr; Vorheriger</button>
          <button class="btn btn-outline btn-sm" onclick="resetCalendarToday()">Heute</button>
          <button class="btn btn-outline btn-sm" onclick="shiftCalendarMonth(1)">Nächster &rarr;</button>
        </div>
      </div>
      <div style="font-size:0.8rem;color:var(--muted);margin-bottom:10px">
        <span class="badge badge-amber">Gold markiert</span> = Du bist als Schiedsrichter eingeteilt / vorgeschlagen &bull; Klick auf ein Spiel öffnet den Spielplan.
      </div>
      <div class="cal-grid">
        <div class="cal-dow">Mo</div>
        <div class="cal-dow">Di</div>
        <div class="cal-dow">Mi</div>
        <div class="cal-dow">Do</div>
        <div class="cal-dow">Fr</div>
        <div class="cal-dow">Sa</div>
        <div class="cal-dow">So</div>
        ${cellsHtml}
      </div>
      <div class="cal-agenda">${agendaHtml}</div>
    </div>
    <div class="card">
      <h3 style="margin-top:0;font-size:1rem">Termine im ${esc(monthLabel)}</h3>
      ${
        monthGames.length === 0
          ? `<p style="color:var(--muted);margin:0">Keine Hallenspiele in diesem Monat eingetragen.</p>`
          : `<table class="responsive-table">
              <thead><tr><th>Datum &amp; Uhrzeit</th><th>Spiel</th><th>Schiri 1</th><th>Schiri 2</th></tr></thead>
              <tbody>
                ${monthGames
                  .map((g) => {
                    const c1 = g.chains[0];
                    const c2 = g.chains[1];
                    const r1 = c1 ? fullName(c1.pendingAssignee || c1.currentAssignee) : "–";
                    const r2 = c2 ? fullName(c2.pendingAssignee || c2.currentAssignee) : "–";
                    return `<tr>
                      <td class="cell-main"><strong>${esc(g.title)}</strong><div class="player-meta">${formatDate(g.kickoff_at)}</div></td>
                      <td data-label="Datum &amp; Uhrzeit">${formatDate(g.kickoff_at)}</td>
                      <td data-label="Schiri 1">${esc(r1)} ${c1 ? statusBadge(c1.status) : ""}</td>
                      <td data-label="Schiri 2">${esc(r2)} ${c2 ? statusBadge(c2.status) : ""}</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;
}

function renderTasksTab() {
  const uId = state.user.id;
  const pendingForMe = [];
  const voluntaryRequestsForMe = [];
  const myAssignments = [];

  for (const g of state.data.games) {
    for (const ch of g.chains) {
      const responsibleId = ch.pending_assignee_id ?? ch.current_assignee_id;
      if (
        (ch.status === "PENDING_HANDOFF" || ch.status === "ASSIGNED") &&
        responsibleId === uId
      ) {
        pendingForMe.push({ g, ch });
      }
      if (ch.status === "VOLUNTARY_REQUESTED" && responsibleId === uId) {
        voluntaryRequestsForMe.push({ g, ch });
      }
      if (responsibleId === uId) {
        myAssignments.push({ g, ch });
      }
    }
  }

  let html = `<h2 style="margin-top:0;font-size:1.1rem">Meine Aufgaben &amp; Ansetzungen</h2>`;

  const calToken = state.user?.cal_token || "";
  if (calToken) {
    const origin = window.location.origin;
    const httpsCalUrl = `${origin}/api/calendar/feed/${calToken}.ics`;
    const webcalUrl = httpsCalUrl.replace(/^https?:\/\//i, "webcal://");
    html += `
      <div class="card cal-sync-box">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:1.3rem">🗓</span>
              <strong style="font-size:0.98rem">Persönlicher Schiedsrichter-Kalender</strong>
            </div>
            <p style="margin:4px 0 0 0;font-size:0.83rem;color:var(--muted);max-width:560px">
              Abonniere deine Spiele direkt in Apple Kalender, Google Kalender oder Outlook. Neue Ansetzungen und Änderungen synchronisieren sich automatisch.
            </p>
          </div>
          <div class="btn-row" style="margin-top:2px">
            <a href="${webcalUrl}" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px">
              <span>📅</span> 1-Klick-Abo
            </a>
            <button class="btn btn-outline btn-sm" onclick="copyCalLink('${httpsCalUrl}')" style="display:inline-flex;align-items:center;gap:6px">
              <span>🔗</span> Link kopieren
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Offene Zahlungen für mich (Weitergabe-Gebühren)
  const myOpenPayments = (state.data.events || []).filter(
    (e) => e.from_user_id === uId && e.payment_status === "OPEN" && getRemainingOpenCents(e) > 0
  );

  if (pendingForMe.length === 0 && voluntaryRequestsForMe.length === 0 && myOpenPayments.length === 0) {
    html += `<div class="alert alert-info">Aktuell liegen keine offenen Aufgaben für dich vor. Alles erledigt! 🎉</div>`;
  }

  // 1. Offene Zahlungsaufforderungen für Weitergaben
  if (myOpenPayments.length > 0) {
    const ts = state.data?.treasurySettings || {};
    const totalMyOpenCents = myOpenPayments.reduce(
      (acc, e) => acc + getRemainingOpenCents(e),
      0
    );
    const myOpenRefCodes = myOpenPayments.map((ev) => {
      const g = state.data?.games?.find((game) => game.id === ev.game_id);
      const ch = g?.chains?.find((c) => c.id === ev.chain_id);
      return ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : "");
    }).filter(Boolean);

    html += `
      <div class="card" style="border-left:4px solid var(--danger);background:#fff9f9">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px">
          <div>
            <strong style="color:var(--danger);font-size:1.02rem;display:flex;align-items:center;gap:6px">
              <span>💳</span> Offene Weitergabe-Gebühr zu zahlen
            </strong>
            <p style="margin:4px 0 0 0;font-size:0.85rem;color:var(--text)">
              Du hast ein oder mehrere Spiele weitergegeben (§ 4). Bitte zahle den offenen Betrag von insgesamt <strong>${formatEuro(totalMyOpenCents)}</strong> in die Mannschaftskasse / den Schiri-Topf ein.
            </p>
          </div>
          <span class="badge badge-red" style="font-size:0.85rem;padding:4px 8px">${formatEuro(totalMyOpenCents)} offen</span>
        </div>

        <div style="margin:14px 0 10px 0;display:flex;flex-direction:column;gap:8px">
          ${myOpenPayments
            .map((ev) => {
              const g = state.data?.games?.find((game) => game.id === ev.game_id);
              const ch = g?.chains?.find((c) => c.id === ev.chain_id);
              const refCode = ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : "");
              const due = getRemainingOpenCents(ev);
              const totalFee = Math.max(0, (ev.fee_total_cents || 0) - (ev.waived_amount_cents || 0));
              const payUrl = ts.paypal ? buildPayPalUrl(ts.paypal, due, `${refCode ? `${refCode} ` : ""}${g?.title || ""}`.trim()) : "";
              return `
                <div style="background:#ffffff;border:1px solid #fed7d7;border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;flex-wrap:wrap;gap:6px">
                  <div>
                    <div style="display:flex;align-items:center;gap:6px">
                      ${refCode ? `<span class="badge badge-gray">${esc(refCode)}</span>` : ""}
                      <strong>${esc(g?.title || "Schiri-Spiel")}</strong>
                    </div>
                    <div style="color:var(--muted);font-size:0.75rem;margin-top:2px">Weitergabe am ${formatDate(ev.created_at)} ${ev.public_note ? `&bull; „${esc(ev.public_note)}“` : ""}${ev.credit_offset_cents > 0 ? ` &bull; Gesamt: ${formatEuro(totalFee)} (${formatEuro(ev.credit_offset_cents)} bereits verrechnet)` : ""}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <strong style="color:var(--danger)">${formatEuro(due)}</strong>
                    ${
                      payUrl && myOpenPayments.length > 1
                        ? `<a href="${payUrl}" target="_blank" rel="noopener" class="btn btn-outline btn-sm" style="font-size:0.75rem;padding:3px 8px;text-decoration:none">🅿️ Zahlen</a>`
                        : ""
                    }
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>

        <!-- Zahlungsdaten & Aktionen -->
        <div style="background:#ffffff;border:1px dashed #e2e8f0;border-radius:7px;padding:12px;margin-top:8px;font-size:0.85rem">
          <strong style="display:block;margin-bottom:6px;color:#1e293b">Bank- &amp; Zahlungsdaten der Mannschaftskasse:</strong>
          <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(200px, 1fr));gap:8px;margin-bottom:10px">
            <div>
              <div style="font-size:0.75rem;color:var(--muted)">Empfänger:</div>
              <strong>${esc(ts.recipient || "RHTC 2. Herren Kasse")}</strong>
            </div>
            ${
              ts.iban
                ? `
                  <div>
                    <div style="font-size:0.75rem;color:var(--muted)">IBAN:</div>
                    <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:0.85rem;user-select:all">${esc(ts.iban)}</code>
                  </div>
                `
                : `<div style="color:var(--muted);font-size:0.8rem">IBAN wird noch durch Kassenwart hinterlegt.</div>`
            }
          </div>

          <div class="btn-row" style="margin:0;gap:8px">
            ${
              ts.paypal
                ? `
                  <a href="${buildPayPalUrl(ts.paypal, totalMyOpenCents, myOpenRefCodes.join(", "))}" target="_blank" rel="noopener" class="btn btn-primary btn-sm" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;background:#0070ba;border-color:#0070ba">
                    <span>🅿️</span> ${myOpenPayments.length > 1 ? `Gesamt per PayPal zahlen (${formatEuro(totalMyOpenCents)})` : `Direkt per PayPal zahlen (${formatEuro(totalMyOpenCents)})`}
                  </a>
                `
                : ""
            }
            ${
              ts.iban
                ? `
                  <button type="button" class="btn btn-outline btn-sm" onclick="copyIbanToClipboard('${esc(ts.iban)}')">
                    📋 IBAN kopieren
                  </button>
                `
                : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  for (const { g, ch } of pendingForMe) {
    html += `
      <div class="card" style="border-left:4px solid var(--warn)">
        <strong>Unbestätigte Zuweisung – bitte annehmen oder weiterleiten</strong>
        <p style="margin:6px 0">${esc(g.title)} (${formatDate(g.kickoff_at)}, Slot ${ch.slot_number})</p>
        <div class="btn-row">
          <button class="btn btn-success btn-sm" onclick="respondHandoff(${ch.id}, 'ACCEPT')">Annehmen (Bestätigen)</button>
          <button class="btn btn-warn btn-sm" onclick="handoffById(${ch.id})">Weiterleiten (Ehrenamt / Härtefall / 15 €)</button>
          <button class="btn btn-outline btn-sm" onclick="downloadGameIcs(${ch.id})" title="Als Kalender-Termin (.ics) herunterladen">📅 In Kalender</button>
        </div>
      </div>
    `;
  }

  for (const { g, ch } of voluntaryRequestsForMe) {
    html += `
      <div class="card" style="border-left:4px solid var(--info)">
        <strong>Übernahme angefragt</strong>
        <p style="margin:6px 0">${esc(fullName(ch.voluntaryRequester))} möchte dein unbestätigtes Spiel <strong>${esc(g.title)}</strong> (${formatDate(g.kickoff_at)}) übernehmen.</p>
        <div class="btn-row">
          <button class="btn btn-success btn-sm" onclick="decideVolunteer(${ch.id}, 'APPROVE')">Übernahme bestätigen</button>
          <button class="btn btn-danger btn-sm" onclick="decideVolunteer(${ch.id}, 'REJECT')">Ablehnen (selbst pfeifen)</button>
        </div>
      </div>
    `;
  }

  html += `<div class="card"><h3 style="margin-top:0;font-size:1rem">Meine Spiele als Schiedsrichter</h3>`;
  if (myAssignments.length === 0) {
    html += `<p style="color:var(--muted)">Du bist aktuell für kein Spiel angesetzt.</p>`;
  } else {
    html += `<table class="responsive-table"><thead><tr><th>ID</th><th>Spiel</th><th>Termin</th><th>Slot</th><th>Status</th><th>Topf</th><th style="text-align:right">Kalender</th></tr></thead><tbody>`;
    for (const { g, ch } of myAssignments) {
      html += `<tr>
        <td class="cell-main"><strong>${esc(g.title)}</strong> <span class="badge badge-gray">${esc(ch.ref_code || "–")}</span></td>
        <td data-label="Termin">${formatDate(g.kickoff_at)}</td>
        <td data-label="Slot">Slot ${ch.slot_number}</td>
        <td data-label="Status">${statusBadge(ch.status)}</td>
        <td data-label="Topf">${ch.payout_pool_cents > 0 ? formatEuro(ch.payout_pool_cents) : "–"}</td>
        <td data-label="Kalender" style="text-align:right">
          <button class="btn btn-outline btn-sm" onclick="downloadGameIcs(${ch.id})" title="Als .ics herunterladen" style="padding:4px 8px;font-size:0.8rem;white-space:nowrap">
            📅 In Kalender
          </button>
        </td>
      </tr>`;
    }
    html += `</tbody></table>`;
  }
  html += `</div>`;
  return html;
}

function renderPlayersTab() {
  const isWart =
    state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN";
  const selectableIds = state.data.players
    .filter((p) => p.id !== state.user.id)
    .map((p) => p.id);
  const selectedCount = state.selectedPlayerIds.filter((id) =>
    selectableIds.includes(id)
  ).length;
  const allSelected =
    selectableIds.length > 0 && selectedCount === selectableIds.length;

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:1.1rem">Mannschaftsliste (§ 2 &amp; § 7)</h2>
      <div class="btn-row" style="margin:0">
        <button class="btn btn-outline" onclick="exportPlayersCsv()">CSV-Export</button>
        ${
          isWart
            ? `
              ${selectedCount > 0 ? `<button class="btn btn-danger btn-sm" onclick="bulkDeleteSelected()">Ausgewählte löschen (${selectedCount})</button>` : ""}
              <button class="btn btn-outline" onclick="openImportCsvModal()">CSV importieren</button>
              <button class="btn btn-primary" onclick="openAddPlayerModal()">+ Spieler anlegen</button>
            `
            : ""
        }
      </div>
    </div>
    <div class="card" style="overflow-x:hidden">
      <table class="players-table">
        <thead>
          <tr>
            ${isWart ? `<th class="col-select" style="width:30px"><input type="checkbox" ${allSelected ? "checked" : ""} onchange="toggleSelectAllPlayers(this.checked)" title="Alle auswählen" /></th>` : ""}
            <th class="col-rank" style="width:38px">#</th>
            <th class="col-player">Spieler &amp; Kontakt</th>
            <th class="col-status" style="width:125px">Status</th>
            <th class="col-deployed" style="width:220px">Einsätze</th>
            <th class="col-open" style="width:85px">Offen</th>
          </tr>
        </thead>
        <tbody>
  `;

  state.data.players.forEach((p, idx) => {
    const isSelf = p.id === state.user.id;
    const isChecked = state.selectedPlayerIds.includes(p.id);
    const hasExtraDetails = Boolean(p.mobile_number);
    html += `
      <tr class="has-mobile-accordion" id="player-row-${p.id}">
        ${
          isWart
            ? `<td data-label="Auswahl" class="col-select"><input type="checkbox" ${isChecked ? "checked" : ""} ${isSelf ? "disabled title='Eigener Account'" : ""} onchange="toggleSelectPlayer(${p.id}, this.checked)" /></td>`
            : ""
        }
        <td data-label="#" class="col-rank">${idx + 1}${p.list_order_override !== null && p.list_order_override !== undefined ? ` <span class="badge badge-gray" title="Manuelle Position (§ 2 Abs. 4)">#${p.list_order_override}</span>` : ""}</td>
        <td class="cell-main col-player">
          <div>
            ${
              isWart
                ? `<strong style="cursor:pointer;color:var(--primary);text-decoration:underline" onclick="openEditPlayerModal(${p.id})" title="Klicken zum Bearbeiten">${esc(p.last_name)}, ${esc(p.first_name)}</strong>`
                : `<strong>${esc(p.last_name)}, ${esc(p.first_name)}</strong>`
            }
            <span class="badge badge-gray">${roleLabel(p.role)}</span>
          </div>
          <div class="player-meta">${esc(p.email)}</div>
        </td>
        <td data-label="Status" class="col-status">
          <div class="player-badges">
            ${p.is_active_in_list ? `<span class="badge badge-green">Aktiv</span>` : `<span class="badge badge-gray">Ausgen.</span>`}
            ${p.is_volunteer_exempt ? `<span class="badge badge-blue">Ehrenamt</span>` : ""}
          </div>
        </td>
        <td data-label="Einsätze" class="col-deployed">
          <strong>${p.deployedCount}</strong> eingesetzt${p.isDeployedOverridden ? ` <span class="badge badge-gray" style="font-size:0.7rem;vertical-align:middle" title="Manuell korrigiert">korr.</span>` : ""} / ${p.activeAssigned} anges.
        </td>
        <td data-label="Offen" class="col-open">${p.openPaymentCents > 0 ? `<strong style="color:var(--danger)">${formatEuro(p.openPaymentCents)}</strong>` : "0,00 €"}</td>
        ${
          hasExtraDetails
            ? `
              <td class="mobile-secondary" data-label="Kontakt" style="flex-direction:column;align-items:flex-start;text-align:left;background:#f8fafc;border-radius:6px;padding:8px 10px;margin-top:4px">
                <div style="font-size:0.8rem">📞 ${esc(p.mobile_number)}</div>
              </td>
              <td style="padding:0;border:none">
                <button type="button" class="mobile-accordion-toggle" onclick="toggleMobileAccordion('player-row-${p.id}', this)">
                  <span>Details</span> <span class="acc-arrow">▾</span>
                </button>
              </td>
            `
            : ""
        }
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  return html;
}

function renderTreasuryTab() {
  const isKassenwart = state.user.role === "KASSENWART" || state.user.role === "ADMIN";
  const s = state.data.summary;

  const paymentEvents = state.data.events.filter(
    (e) => e.fee_total_cents > 0 || e.hardship_status !== "NONE"
  );
  const payoutChains = [];
  for (const g of state.data.games) {
    for (const ch of g.chains) {
      if (ch.payout_pool_cents > 0) payoutChains.push({ g, ch });
    }
  }

  // Berechnung der Salden pro Spieler (für Sammelabwicklung & Verrechnung)
  const playerBalances = [];
  for (const p of state.data.players || []) {
    // 1. Offenes Guthaben: Töpfe, bei denen der Spieler Einsatz geleistet hat (CONFIRMED_DEPLOYED) und payout_settled != 1
    const playerReadyChains = payoutChains.filter(
      ({ ch }) =>
        ch.current_assignee_id === p.id &&
        ch.status === "CONFIRMED_DEPLOYED" &&
        !ch.payout_settled
    );
    const readyPayoutCents = playerReadyChains.reduce(
      (acc, { ch }) => acc + (ch.payout_pool_cents || 0),
      0
    );

    // 2. Offene Weitergabe-Gebühren des Spielers
    const playerOpenEvents = paymentEvents.filter(
      (e) => e.from_user_id === p.id && e.payment_status === "OPEN" && getRemainingOpenCents(e) > 0
    );
    const openFeeCents = playerOpenEvents.reduce(
      (acc, e) => acc + getRemainingOpenCents(e),
      0
    );

    // Nur Spieler aufführen, die entweder offenes Guthaben oder offene Gebühren haben
    if (readyPayoutCents > 0 || openFeeCents > 0) {
      const netBalanceCents = readyPayoutCents - openFeeCents; // positiv = Auszahlungsguthaben, negativ = Schulden an Kasse
      playerBalances.push({
        player: p,
        readyPayoutCents,
        openFeeCents,
        netBalanceCents,
        readyChains: playerReadyChains,
        openEvents: playerOpenEvents,
      });
    }
  }

  // Sortiere Spieler mit Aktionsbedarf nach Relevanz (höchstes Guthaben/Differenz zuerst)
  playerBalances.sort((a, b) => b.readyPayoutCents - a.readyPayoutCents || b.openFeeCents - a.openFeeCents);

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:1.1rem">Mannschaftskasse, Auszahlungen &amp; Härtefälle (§ 4, § 5, § 8)</h2>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        ${isKassenwart ? `<button class="btn btn-primary btn-sm" onclick="openTreasurySettingsModal()">⚙️ Bankverbindung / IBAN</button>` : ""}
        <button class="btn btn-outline btn-sm" onclick="exportTreasuryCsv()">Kassen-Export (CSV)</button>
      </div>
    </div>
    <div class="grid-4">
      <div class="stat-card">
        <div class="stat-label">Anteil Mannschaftskasse</div>
        <div class="stat-value">${formatEuro(s.totalTeamPotCents)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Offene Zahlungen</div>
        <div class="stat-value" style="color:var(--danger)">${formatEuro(s.totalOpenPaymentsCents)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Bezahlte Gebühren</div>
        <div class="stat-value" style="color:var(--success)">${formatEuro(s.totalPaidCents)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Offene Auszahlungstöpfe</div>
        <div class="stat-value" style="color:var(--primary)">${formatEuro(s.totalPayoutPoolOpenCents)}</div>
      </div>
    </div>

    <!-- Neue Sektion: Spieler-Salden & Sammelabwicklung -->
    <div class="card" style="overflow-x:auto;border-top:3px solid var(--primary);margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div>
          <h3 style="margin:0;font-size:1rem;display:flex;align-items:center;gap:6px">
            <span>⚖️ Spieler-Salden &amp; Sammelabwicklung</span>
            <span class="badge badge-gold" style="font-size:0.75rem">${playerBalances.length} ${playerBalances.length === 1 ? "Spieler" : "Spieler"} mit Saldo</span>
          </h3>
          <p style="font-size:0.82rem;color:var(--muted);margin:3px 0 0 0">
            Hier können offene Topf-Guthaben mit offenen Weitergabe-Gebühren direkt verrechnet oder in einem Schritt gesammelt ausgezahlt werden.
          </p>
        </div>
      </div>

      ${
        playerBalances.length === 0
          ? `<p style="color:var(--muted);margin:12px 0 4px">Aktuell keine offenen Spielerguthaben oder ausstehenden Gebühren vorhanden.</p>`
          : `
            <table class="responsive-table">
              <thead>
                <tr>
                  <th>Spieler</th>
                  <th>Topf-Guthaben (bereit)</th>
                  <th>Offene Gebühren</th>
                  <th>Netto-Saldo</th>
                  ${isKassenwart ? `<th>Sammel-Aktion</th>` : ""}
                </tr>
              </thead>
              <tbody>
                ${playerBalances
                  .map((b) => {
                    const isNetPlus = b.netBalanceCents > 0;
                    const isNetZero = b.netBalanceCents === 0;
                    const isNetMinus = b.netBalanceCents < 0;

                    const saldoClass = isNetPlus ? "color:var(--success)" : isNetMinus ? "color:var(--danger)" : "color:var(--muted)";
                    const saldoText = isNetPlus
                      ? `+${formatEuro(b.netBalanceCents)} (Auszahlung)`
                      : isNetMinus
                      ? `${formatEuro(b.netBalanceCents)} (Nachforderung)`
                      : `0,00 € (Ausgeglichen)`;

                    return `
                      <tr class="has-mobile-accordion" id="balance-row-${b.player.id}">
                        <td class="cell-main" data-label="Spieler">
                          <strong>${esc(b.player.last_name)}, ${esc(b.player.first_name)}</strong>
                          <div class="player-meta">${roleLabel(b.player.role)} &bull; ${esc(b.player.email)}</div>
                        </td>
                        <td data-label="Netto-Saldo">
                          <strong style="${saldoClass};font-size:0.95rem">${saldoText}</strong>
                        </td>
                        <td data-label="Topf-Guthaben" class="mobile-secondary">
                          ${
                            b.readyPayoutCents > 0
                              ? `<strong style="color:var(--success)">${formatEuro(b.readyPayoutCents)}</strong> <span style="font-size:0.75rem;color:var(--muted)">(${b.readyChains.length} ${b.readyChains.length === 1 ? "Topf" : "Töpfe"})</span>`
                              : `<span style="color:var(--muted)">0,00 €</span>`
                          }
                        </td>
                        <td data-label="Offene Gebühren" class="mobile-secondary">
                          ${
                            b.openFeeCents > 0
                              ? `<strong style="color:var(--danger)">${formatEuro(b.openFeeCents)}</strong> <span style="font-size:0.75rem;color:var(--muted)">(${b.openEvents.length}× offen)</span>`
                              : `<span style="color:var(--muted)">0,00 €</span>`
                          }
                        </td>
                        ${
                          isKassenwart
                            ? `<td data-label="Sammel-Aktion" class="mobile-secondary">
                                <div class="btn-row" style="margin:0;gap:4px">
                                  <button class="btn btn-primary btn-sm" onclick="openSettlePlayerModal(${b.player.id})" title="Abrechnung & Verrechnung für ${esc(fullName(b.player))} öffnen">
                                    Abrechnen / Verrechnen
                                  </button>
                                  ${
                                    b.openFeeCents > 0
                                      ? `<button class="btn btn-outline btn-sm" onclick="openPlayerFeeReminderModal(${b.player.id})" title="Zahlungserinnerung für alle offenen Gebühren senden">💬 Mahnung</button>`
                                      : ""
                                  }
                                </div>
                              </td>`
                            : ""
                        }
                        <td style="padding:0;border:none">
                          <button type="button" class="mobile-accordion-toggle" onclick="toggleMobileAccordion('balance-row-${b.player.id}', this)">
                            <span>Aufschlüsselung &amp; Aktionen</span> <span class="acc-arrow">▾</span>
                          </button>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          `
      }
    </div>

    <div class="card" style="overflow-x:auto">
      <h3 style="margin-top:0;font-size:1rem">Weitergabe-Zahlungen &amp; Härtefallanträge</h3>
      ${
        paymentEvents.length === 0
          ? `<p style="color:var(--muted)">Noch keine zahlungspflichtigen Weitergaben vorhanden.</p>`
          : `<table class="responsive-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Spieler</th>
                  <th>Datum</th>
                  <th>Betrag</th>
                  <th>Status</th>
                  <th>Härtefall (§ 8)</th>
                  ${isKassenwart ? `<th>Aktion</th>` : ""}
                </tr>
              </thead>
              <tbody>
                ${paymentEvents
                  .map((ev) => {
                    const g = state.data?.games?.find((game) => game.id === ev.game_id);
                    const ch = g?.chains?.find((c) => c.id === ev.chain_id);
                    const refCode = ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : `SR-${ev.chain_id}`);
                    const totalFee = Math.max(0, (ev.fee_total_cents || 0) - (ev.waived_amount_cents || 0));
                    const remainingOpen = getRemainingOpenCents(ev);
                    return `
                      <tr class="has-mobile-accordion" id="pay-ev-row-${ev.id}">
                        <td data-label="ID"><span class="badge badge-gray">${esc(refCode)}</span></td>
                        <td class="cell-main" data-label="Spieler">
                          <strong>${esc(fullName(ev.fromUser))}</strong>
                          ${g ? `<div class="player-meta">${esc(g.title)}</div>` : ""}
                        </td>
                        <td data-label="Betrag">
                          <strong>${formatEuro(totalFee)}</strong>
                          ${ev.waived_amount_cents > 0 ? `<div style="font-size:0.75rem;color:var(--muted)">(Erlass: ${formatEuro(ev.waived_amount_cents)})</div>` : ""}
                          ${ev.payment_status === "OPEN" && ev.credit_offset_cents > 0 ? `<div style="font-size:0.75rem;color:var(--muted)">(Verrechnet: ${formatEuro(ev.credit_offset_cents)} &bull; Offen: ${formatEuro(remainingOpen)})</div>` : ""}
                        </td>
                        <td data-label="Status">${chainPaymentBadge(ev) || esc(ev.payment_status)}</td>
                        <td data-label="Datum" class="mobile-secondary">${formatDate(ev.created_at)}</td>
                        <td data-label="Härtefall (§ 8)" class="mobile-secondary">
                          ${ev.hardship_status === "NONE" ? "–" : esc(ev.hardship_status)}
                          ${isKassenwart && ev.hardship_reason_confidential ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px">Vertraulich: ${esc(ev.hardship_reason_confidential)}</div>` : ""}
                        </td>
                        ${
                          isKassenwart
                            ? `<td data-label="Aktion" class="mobile-secondary">
                                <div class="btn-row" style="margin:0;gap:4px">
                                  ${ev.payment_status === "OPEN" ? `<button class="btn btn-success btn-sm" onclick="markPaid(${ev.id})">Als bezahlt</button>` : ""}
                                  ${ev.payment_status === "OPEN" ? `<button class="btn btn-outline btn-sm" onclick="openPaymentReminderModal(${ev.id})" title="Zahlungserinnerung senden">💬 Mahnung</button>` : ""}
                                  ${ev.hardship_status === "PENDING" ? `<button class="btn btn-warn btn-sm" onclick="openHardshipById(${ev.id})">Härtefall</button>` : ""}
                                </div>
                              </td>`
                            : ""
                        }
                        <td style="padding:0;border:none">
                          <button type="button" class="mobile-accordion-toggle" onclick="toggleMobileAccordion('pay-ev-row-${ev.id}', this)">
                            <span>Datum &amp; Aktionen</span> <span class="acc-arrow">▾</span>
                          </button>
                        </td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>`
      }
    </div>

    <div class="card" style="overflow-x:auto">
      <h3 style="margin-top:0;font-size:1rem">Auszahlungstöpfe der Weitergabestränge (§ 4 Abs. 3, § 5 Abs. 4)</h3>
      <p style="font-size:0.82rem;color:var(--muted);margin:-4px 0 12px 0">
        Die Auszahlung des Topfes erfolgt grundsätzlich erst an denjenigen Schiedsrichter, der das Spiel bestätigt übernommen und auch offiziell gepfiffen hat.
      </p>
      ${
        payoutChains.length === 0
          ? `<p style="color:var(--muted)">Keine Auszahlungstöpfe vorhanden.</p>`
          : `<table class="responsive-table">
              <thead><tr><th>ID</th><th>Spiel</th><th>Schiedsrichter</th><th>Status</th><th>Betrag</th><th>Auszahlung</th></tr></thead>
              <tbody>
                ${payoutChains
                  .map(
                    ({ g, ch }) => {
                      const isDeployed = ch.status === "CONFIRMED_DEPLOYED" || ch.status === "REPORTED_DEPLOYED";
                      const isConfirmed = ch.status === "CONFIRMED";
                      let actualRefHtml = "–";

                      if (isDeployed || isConfirmed) {
                        const ref = ch.currentAssignee;
                        const name = ref ? fullName(ref) : "–";
                        actualRefHtml = `<strong>${esc(name)}</strong> ${isDeployed ? `<span class="badge badge-green" style="font-size:0.7rem">Gepfiffen</span>` : `<span class="badge badge-blue" style="font-size:0.7rem">Bestätigt</span>`}`;
                      } else if (ch.status === "VOLUNTARY_REQUESTED") {
                        const vol = ch.voluntaryRequester;
                        const target = ch.pendingAssignee || ch.currentAssignee;
                        actualRefHtml = `<strong>${esc(fullName(vol || target))}</strong> <span class="badge badge-amber" style="font-size:0.7rem">Übernahme angefragt</span>${target && vol ? `<div style="font-size:0.74rem;color:var(--muted)">Zustimmung von ${esc(fullName(target))} ausstehend</div>` : ""}`;
                      } else if (ch.status === "PENDING_HANDOFF") {
                        const target = ch.pendingAssignee || ch.currentAssignee;
                        actualRefHtml = `<strong>${esc(fullName(target))}</strong> <span class="badge badge-amber" style="font-size:0.7rem">Vorgeschlagen (Offen)</span>`;
                      } else {
                        const ref = ch.currentAssignee;
                        actualRefHtml = ref ? `<strong>${esc(fullName(ref))}</strong>` : `<span style="color:var(--muted)">Noch unbesetzt</span>`;
                      }

                      const canSettle = isKassenwart && ch.status === "CONFIRMED_DEPLOYED" && !ch.payout_settled;

                      return `
                  <tr class="has-mobile-accordion" id="payout-row-${ch.id}">
                    <td data-label="ID"><span class="badge badge-gray">${esc(ch.ref_code || `SR-00${ch.slot_number}`)}</span></td>
                    <td class="cell-main" data-label="Spiel"><strong>${esc(g.title)}</strong><div class="player-meta">${formatDate(g.kickoff_at)} &bull; Slot ${ch.slot_number}</div></td>
                    <td data-label="Betrag"><strong>${formatEuro(ch.payout_pool_cents)}</strong></td>
                    <td data-label="Status">${statusBadge(ch.status)}</td>
                    <td data-label="Schiedsrichter" class="mobile-secondary">${actualRefHtml}</td>
                    <td data-label="Auszahlung" class="mobile-secondary">
                      ${
                        ch.payout_settled
                          ? `<span class="badge badge-green">Ausgezahlt an ${esc(fullName(ch.currentAssignee))}</span>`
                          : canSettle
                          ? `<button class="btn btn-primary btn-sm" onclick="settlePayout(${ch.id})">An ${esc(fullName(ch.currentAssignee))} auszahlen</button>`
                          : ch.status === "CONFIRMED_DEPLOYED"
                          ? `<span class="badge badge-blue">Bereit (${esc(fullName(ch.currentAssignee))})</span>`
                          : `<span class="badge badge-gray" title="Auszahlung erfolgt erst an denjenigen, der das Spiel bestätigt übernommen und auch gepfiffen hat (§ 4 Abs. 3, § 5 Abs. 4)">Offen (nach Einsatz)</span>`
                      }
                    </td>
                    <td style="padding:0;border:none">
                      <button type="button" class="mobile-accordion-toggle" onclick="toggleMobileAccordion('payout-row-${ch.id}', this)">
                        <span>Schiri &amp; Auszahlung</span> <span class="acc-arrow">▾</span>
                      </button>
                    </td>
                  </tr>`;
                    }
                  )
                  .join("")}
              </tbody>
            </table>`
      }
    </div>
  `;
  return html;
}

function chainReasonLabel(reasonType, isShortNotice, eventType) {
  if (eventType === "VOLUNTEER_APPROVED") return "Freiwillige Übernahme";
  if (eventType === "VOLUNTEER_REJECTED") return "Übernahme abgelehnt";
  if (eventType === "VOLUNTEER_AUTO_FORWARD") return "Auto-Weiterleitung";
  if (eventType === "HANDOFF_SKIPPED_UNAVAILABLE") return "Übersprungen (abgemeldet)";
  if (eventType === "HANDOFF_ACCEPTED") return "Weitergabe angenommen";
  if (eventType === "SQUAD_NOMINATION" || reasonType === "SQUAD_NOMINATION") return "Kader-Nominierung";
  if (reasonType === "VOLUNTEER_EXEMPT") return "Ehrenamt (§ 7)";
  if (reasonType === "HARDSHIP") return "Härtefall (§ 8)";
  if (reasonType === "SHORT_NOTICE" || isShortNotice) return "Kurzfristig (< 48h)";
  if (reasonType === "REGULAR") return "Reguläre Weitergabe";
  if (reasonType === "UNAVAILABLE_SKIP") return "Übersprungen";
  return eventType || "Ereignis";
}

function chainPaymentBadge(ev) {
  if (!ev || (ev.fee_total_cents <= 0 && ev.hardship_status === "NONE")) return "";
  if (ev.payment_status === "PAID") return `<span class="badge badge-green">Bezahlt</span>`;
  if (ev.payment_status === "WAIVED_FULL") return `<span class="badge badge-amber">Erlassen</span>`;
  if (ev.payment_status === "WAIVED_PARTIAL") return `<span class="badge badge-amber">Teilerlass</span>`;
  if (ev.payment_status === "OPEN") {
    if (ev.hardship_status === "PENDING") return `<span class="badge badge-amber">Offen (Härtefall prüfen)</span>`;
    return `<span class="badge badge-red">Zahlung offen</span>`;
  }
  return "";
}

function renderChainsTab() {
  const isKassenwart = state.user.role === "KASSENWART";
  const allChains = [];
  for (const g of state.data.games) {
    for (const ch of g.chains) {
      allChains.push({ g, ch });
    }
  }

  const hasHandoffEvent = (ch) =>
    (ch.events || []).some((e) =>
      [
        "REGULAR_HANDOFF",
        "HANDOFF_SKIPPED_UNAVAILABLE",
        "SQUAD_NOMINATION",
        "VOLUNTEER_REQUEST",
        "VOLUNTEER_APPROVED",
        "VOLUNTEER_REJECTED",
        "VOLUNTEER_AUTO_FORWARD",
      ].includes(e.event_type)
    );

  const hasOpenPayment = (ch) =>
    (ch.events || []).some((e) => e.payment_status === "OPEN");

  let filtered = allChains.filter(({ g, ch }) => {
    if (!state.chainShowAllSlots && !hasHandoffEvent(ch)) return false;
    if (state.chainFilterStatus === "mine") {
      const isMine =
        ch.current_assignee_id === state.user.id ||
        ch.pending_assignee_id === state.user.id ||
        ch.voluntary_requester_id === state.user.id ||
        (ch.events || []).some(
          (e) => e.from_user_id === state.user.id || e.to_user_id === state.user.id
        );
      if (!isMine) return false;
    } else if (state.chainFilterStatus === "active") {
      if (ch.status === "CONFIRMED_DEPLOYED") return false;
    } else if (state.chainFilterStatus === "deployed") {
      if (ch.status !== "CONFIRMED_DEPLOYED") return false;
    } else if (state.chainFilterStatus === "open_payment") {
      if (!hasOpenPayment(ch)) return false;
    }
    if (state.chainSearch.trim()) {
      const q = state.chainSearch.trim().toLowerCase();
      const inGame = (g.title || "").toLowerCase().includes(q) || (ch.ref_code || "").toLowerCase().includes(q);
      const inEvents = (ch.events || []).some(
        (e) =>
          fullName(e.fromUser).toLowerCase().includes(q) ||
          fullName(e.toUser).toLowerCase().includes(q)
      );
      const inAssignee =
        fullName(ch.currentAssignee).toLowerCase().includes(q) ||
        fullName(ch.pendingAssignee).toLowerCase().includes(q);
      if (!inGame && !inEvents && !inAssignee) return false;
    }
    return true;
  });

  const renderChainFlow = (ch) => {
    const asc = [...(ch.events || [])].sort((a, b) => a.id - b.id);
    if (asc.length === 0) {
      const assignee = ch.pendingAssignee || ch.currentAssignee;
      return `
        <div class="chain-flow">
          <div class="chain-node current">
            <div class="chain-node-role">Aktuell</div>
            <div class="chain-node-name">${assignee ? esc(fullName(assignee)) : "Unbesetzt"}</div>
          </div>
        </div>
      `;
    }

    const parts = [];
    let hasInitialNode = false;
    let hasPayoutMilestone = false;
    const milestones = [];

    for (const ev of asc) {
      if (ev.event_type === "INITIAL_ASSIGNMENT") {
        hasInitialNode = true;
        const isOnlyNode = asc.length === 1;
        parts.push(`
          <div class="chain-node ${isOnlyNode ? "current" : ""}">
            <div class="chain-node-role">Start-Ansetzung</div>
            <div class="chain-node-name">${ev.toUser ? esc(fullName(ev.toUser)) : "–"}</div>
            <div style="font-size:0.72rem;color:var(--muted)">${formatDate(ev.created_at)}</div>
          </div>
        `);
        continue;
      }

      if (
        ev.event_type === "REPORTED_DEPLOYED" ||
        ev.event_type === "CONFIRMED_DEPLOYED" ||
        ev.event_type === "PAYOUT_SETTLED"
      ) {
        if (ev.event_type === "PAYOUT_SETTLED") {
          if (hasPayoutMilestone) continue;
          hasPayoutMilestone = true;
          const recipient = ev.toUser || ch.currentAssignee;
          const rName = recipient ? fullName(recipient) : "";
          const label = `Topf ausgezahlt${rName ? ` an ${rName}` : ""}`;
          milestones.push({ label, at: ev.created_at });
        } else {
          const referee = ev.fromUser || ch.currentAssignee;
          const uName = referee ? fullName(referee) : "";
          const label =
            ev.event_type === "REPORTED_DEPLOYED"
              ? `Einsatz gemeldet${uName ? ` (${uName})` : ""}`
              : `Einsatz bestätigt${uName ? ` (${uName})` : ""}`;
          milestones.push({ label, at: ev.created_at });
        }
        continue;
      }

      if (ev.event_type === "HANDOFF_ACCEPTED") {
        parts.push(`
          <div class="chain-edge">
            <div class="chain-edge-head">
              <span class="chain-edge-arrow-h">&rarr;</span>
              <span class="chain-edge-arrow-v">&darr;</span>
              <span>Angenommen</span>
            </div>
            <div>${ev.toUser ? `<strong>${esc(fullName(ev.toUser))}</strong> hat übernommen` : "Ansetzung übernommen"}</div>
            <div style="color:var(--muted);font-size:0.72rem">${formatDate(ev.created_at)}</div>
          </div>
        `);
        continue;
      }

      if (ev.event_type === "VOLUNTEER_REQUEST") {
        let volunteerName = ev.toUser ? fullName(ev.toUser) : "";
        if (ev.public_note && ev.public_note.includes("durch ")) {
          volunteerName = ev.public_note.split("durch ")[1] || volunteerName;
        } else if (!volunteerName && ev.fromUser) {
          volunteerName = fullName(ev.fromUser);
        }
        parts.push(`
          <div class="chain-edge">
            <div class="chain-edge-head">
              <span class="chain-edge-arrow-h">&rarr;</span>
              <span class="chain-edge-arrow-v">&darr;</span>
              <span>Übernahme-Anfrage</span>
            </div>
            <div><strong>${esc(volunteerName || "Jemand")}</strong> möchte übernehmen</div>
            <div style="color:var(--muted);font-size:0.72rem">${formatDate(ev.created_at)}</div>
          </div>
        `);
        continue;
      }

      // Transition with fromUser -> toUser
      if (!hasInitialNode && ev.fromUser) {
        hasInitialNode = true;
        parts.push(`
          <div class="chain-node">
            <div class="chain-node-role">Vorherig</div>
            <div class="chain-node-name">${esc(fullName(ev.fromUser))}</div>
          </div>
        `);
      }

      const reasonText = chainReasonLabel(ev.reason_type, ev.is_short_notice, ev.event_type);
      const dueCents = Math.max(0, (ev.fee_total_cents || 0) - (ev.waived_amount_cents || 0));
      const moneyChips = [];
      if (ev.fee_total_cents > 0) {
        moneyChips.push(`<span class="badge badge-gray">Gebühr: ${formatEuro(ev.fee_total_cents)}</span>`);
      }
      if (ev.waived_amount_cents > 0) {
        moneyChips.push(`<span class="badge badge-amber">Erlass: ${formatEuro(ev.waived_amount_cents)}</span>`);
      }
      if (ev.team_pot_cents > 0) {
        moneyChips.push(`<span class="badge badge-gray">Kasse: +${formatEuro(ev.team_pot_cents)}</span>`);
      }
      if (ev.payout_pool_cents > 0) {
        moneyChips.push(`<span class="badge badge-amber">Topf: +${formatEuro(ev.payout_pool_cents)}</span>`);
      }
      if (ev.fee_total_cents > 0 && ev.waived_amount_cents > 0 && dueCents > 0) {
        moneyChips.push(`<span class="badge badge-gray">Rest: ${formatEuro(dueCents)}</span>`);
      }

      parts.push(`
        <div class="chain-edge">
          <div class="chain-edge-head">
            <span class="chain-edge-arrow-h">&rarr;</span>
            <span class="chain-edge-arrow-v">&darr;</span>
            <span>${esc(reasonText)}</span>
          </div>
          <div style="color:var(--muted);font-size:0.72rem">${formatDate(ev.created_at)}</div>
          ${moneyChips.length > 0 ? `<div class="chain-edge-money">${moneyChips.join("")}${chainPaymentBadge(ev)}</div>` : ""}
          ${ev.public_note ? `<div class="chain-edge-note">„${esc(ev.public_note)}“</div>` : ""}
          ${
            isKassenwart && ev.hardship_reason_confidential
              ? `<div class="chain-edge-note" style="color:var(--danger)">Vertraulich: ${esc(ev.hardship_reason_confidential)}</div>`
              : ""
          }
        </div>
      `);

      if (ev.toUser) {
        const isCurrentTarget =
          (ch.pending_assignee_id ?? ch.current_assignee_id) === ev.toUser.id &&
          ev.event_type !== "HANDOFF_SKIPPED_UNAVAILABLE";
        parts.push(`
          <div class="chain-node ${isCurrentTarget ? "current" : ""}">
            <div class="chain-node-role">${
              ev.event_type === "HANDOFF_SKIPPED_UNAVAILABLE"
                ? "Übersprungen"
                : isCurrentTarget
                ? ch.pending_assignee_id
                  ? "Vorgeschlagen (Offen)"
                  : "Aktuell eingeteilt"
                : "Station"
            }</div>
            <div class="chain-node-name">${esc(fullName(ev.toUser))}</div>
          </div>
        `);
      }
    }

    for (const m of milestones) {
      parts.push(`
        <div class="chain-node milestone">
          <div class="chain-node-role">Meilenstein</div>
          <div class="chain-node-name">${esc(m.label)}</div>
          <div style="font-size:0.72rem;color:var(--muted)">${formatDate(m.at)}</div>
        </div>
      `);
    }

    return `<div class="chain-flow">${parts.join("")}</div>`;
  };

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:1.1rem">Weitergabeketten &amp; Geldfluss</h2>
      <span style="font-size:0.85rem;color:var(--muted)">${filtered.length} von ${allChains.length} Slots</span>
    </div>

    <div class="card" style="padding:12px 14px">
      <div class="filter-bar" style="margin-bottom:10px">
        <button class="filter-pill ${state.chainFilterStatus === "all" ? "active" : ""}" onclick="setChainFilter('all')">Alle Status</button>
        <button class="filter-pill ${state.chainFilterStatus === "mine" ? "active" : ""}" onclick="setChainFilter('mine')">Meine Ketten</button>
        <button class="filter-pill ${state.chainFilterStatus === "active" ? "active" : ""}" onclick="setChainFilter('active')">Laufend / Offen</button>
        <button class="filter-pill ${state.chainFilterStatus === "deployed" ? "active" : ""}" onclick="setChainFilter('deployed')">Eingesetzt</button>
        ${
          canViewAdminTabs(state.user)
            ? `<button class="filter-pill ${state.chainFilterStatus === "open_payment" ? "active" : ""}" onclick="setChainFilter('open_payment')">Offene Zahlungen</button>`
            : ""
        }
        <button class="filter-pill ${state.chainShowAllSlots ? "active" : ""}" onclick="toggleChainShowAll()">${state.chainShowAllSlots ? "Nur mit Weitergabe" : "Alle Slots anzeigen"}</button>
      </div>
      <div class="form-group" style="margin:0">
        <input id="chain-search-input" type="text" placeholder="Nach Spiel, ID (z. B. SR-01) oder Spieler suchen..." value="${esc(state.chainSearch)}" oninput="setChainSearch(this.value, this.selectionStart)" />
      </div>
    </div>

    ${
      filtered.length === 0
        ? `<div class="card"><p style="color:var(--muted);margin:0">Keine passenden Weitergabeketten gefunden.</p></div>`
        : filtered
            .map(({ g, ch }) => {
              const teamPotTotal = (ch.events || []).reduce((acc, e) => acc + (e.team_pot_cents || 0), 0);
              return `
                <div class="card chain-card">
                  <div class="chain-card-header">
                    <div>
                      <div style="font-weight:700;font-size:1rem">
                        ${esc(g.title)}
                        <span class="badge badge-gray">Slot ${ch.slot_number}</span>
                        ${ch.ref_code ? `<span class="badge badge-gray">${esc(ch.ref_code)}</span>` : ""}
                      </div>
                      <div style="font-size:0.82rem;color:var(--muted);margin-top:2px">
                        ${formatDate(g.kickoff_at)} &bull; ${esc(g.location || "RHTC Halle")}
                      </div>
                    </div>
                    <div class="chain-money-summary">
                      ${statusBadge(ch.status)}
                      ${teamPotTotal > 0 ? `<span class="badge badge-gray">Kasse: ${formatEuro(teamPotTotal)}</span>` : ""}
                      ${
                        ch.payout_pool_cents > 0
                          ? ch.payout_settled
                            ? `<span class="badge badge-green">Topf: ${formatEuro(ch.payout_pool_cents)} (Ausgezahlt an ${esc(fullName(ch.currentAssignee))})</span>`
                            : ch.status === "CONFIRMED_DEPLOYED"
                            ? `<span class="badge badge-blue">Auszahlung: ${formatEuro(ch.payout_pool_cents)} bereit (${esc(fullName(ch.currentAssignee))})</span>`
                            : `<span class="badge badge-amber" title="Auszahlung geht immer an denjenigen, der das Spiel bestätigt übernommen und gepfiffen hat">Topf: +${formatEuro(ch.payout_pool_cents)} (nach Einsatz)</span>`
                          : ""
                      }
                    </div>
                  </div>
                  ${renderChainFlow(ch)}
                </div>
              `;
            })
            .join("")
    }
  `;
}

function renderInlineMarkdown(rawText, highlightQuery = "") {
  let html = esc(rawText || "");
  // Inline-Code
  html = html.replace(/`([^`]+)`/g, '<code class="bylaw-code">$1</code>');
  // Links [Text](https://...)
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="bylaw-link">$1</a>'
  );
  // Fett + Kursiv
  html = html.replace(/\*\*\*([^*]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  // Fett
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // Kursiv
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");

  if (highlightQuery && highlightQuery.trim()) {
    const safeQ = esc(highlightQuery.trim()).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (safeQ) {
      const re = new RegExp(`(${safeQ})`, "gi");
      html = html
        .split(/(<[^>]+>)/g)
        .map((part) => (part.startsWith("<") ? part : part.replace(re, '<mark class="bylaw-mark">$1</mark>')))
        .join("");
    }
  }
  return html;
}

function renderMarkdownBlocksHtml(lines, highlightQuery = "") {
  const out = [];
  let paragraphLines = [];
  let activeClause = null; // { num, leadBold, textLines, listItems }
  let listType = null; // "ul" | "ol"
  let listItems = [];
  let quoteLines = [];
  let tableLines = [];
  let pendingHr = false;

  const emitPendingHrIfNeeded = () => {
    if (pendingHr && out.length > 0) {
      out.push('<hr class="bylaw-hr" />');
    }
    pendingHr = false;
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) return;
    const tag = listType;
    const cls = tag === "ol" ? "bylaw-list bylaw-list-ordered" : "bylaw-list";
    const itemsHtml = listItems.map((it) => `<li>${renderInlineMarkdown(it, highlightQuery)}</li>`).join("");
    if (activeClause) {
      activeClause.extraHtml.push(`<${tag} class="${cls}">${itemsHtml}</${tag}>`);
    } else {
      emitPendingHrIfNeeded();
      out.push(`<${tag} class="${cls}">${itemsHtml}</${tag}>`);
    }
    listType = null;
    listItems = [];
  };

  const flushClause = () => {
    if (!activeClause) return;
    flushList();
    emitPendingHrIfNeeded();
    const bodyText = renderInlineMarkdown(activeClause.textLines.join(" "), highlightQuery);
    const leadHtml = activeClause.leadBold
      ? `<strong>${renderInlineMarkdown(activeClause.leadBold, highlightQuery)}</strong> `
      : "";
    out.push(`
      <div class="bylaw-clause">
        <span class="bylaw-clause-num">(${esc(activeClause.num)})</span>
        <div class="bylaw-clause-body">
          <p class="bylaw-clause-text">${leadHtml}${bodyText}</p>
          ${activeClause.extraHtml.join("")}
        </div>
      </div>
    `);
    activeClause = null;
  };

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    emitPendingHrIfNeeded();
    out.push(`<p class="bylaw-paragraph">${renderInlineMarkdown(paragraphLines.join(" "), highlightQuery)}</p>`);
    paragraphLines = [];
  };

  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    emitPendingHrIfNeeded();
    out.push(`<blockquote class="bylaw-quote">${renderInlineMarkdown(quoteLines.join(" "), highlightQuery)}</blockquote>`);
    quoteLines = [];
  };

  const flushTable = () => {
    if (tableLines.length === 0) return;
    emitPendingHrIfNeeded();
    const parsedRows = tableLines.map((row) =>
      row
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim())
    );
    const hasSep =
      parsedRows.length >= 2 &&
      parsedRows[1].every((c) => /^:?-{2,}:?$/.test(c));
    const headRow = hasSep ? parsedRows[0] : null;
    const bodyRows = hasSep ? parsedRows.slice(2) : parsedRows;
    const theadHtml = headRow
      ? `<thead><tr>${headRow.map((h) => `<th>${renderInlineMarkdown(h, highlightQuery)}</th>`).join("")}</tr></thead>`
      : "";
    const tbodyHtml = `<tbody>${bodyRows
      .map((r) => `<tr>${r.map((c) => `<td>${renderInlineMarkdown(c, highlightQuery)}</td>`).join("")}</tr>`)
      .join("")}</tbody>`;
    out.push(`<div class="bylaw-table-wrap"><table class="bylaw-table">${theadHtml}${tbodyHtml}</table></div>`);
    tableLines = [];
  };

  const flushAll = () => {
    flushList();
    flushClause();
    flushParagraph();
    flushQuote();
    flushTable();
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (!trimmed) {
      flushAll();
      continue;
    }

    // Horizontale Linie (---, ***, ___)
    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      flushAll();
      pendingHr = true;
      continue;
    }

    // Unterüberschriften (### oder ####)
    const subMatch = trimmed.match(/^(#{3,4})\s+(.+)$/);
    if (subMatch) {
      flushAll();
      emitPendingHrIfNeeded();
      const lvl = subMatch[1].length;
      out.push(`<h${lvl} class="bylaw-subheading">${renderInlineMarkdown(subMatch[2], highlightQuery)}</h${lvl}>`);
      continue;
    }

    // Ungeordnete Liste (*, -, + gefolgt von Leerzeichen)
    const ulMatch = trimmed.match(/^[*+-]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(ulMatch[1]);
      continue;
    }

    // Geordnete Liste (1. ...)
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      flushQuote();
      flushTable();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(olMatch[1]);
      continue;
    }

    // Zitat (> ...)
    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushList();
      flushClause();
      flushParagraph();
      flushTable();
      quoteLines.push(quoteMatch[1]);
      continue;
    }

    // Markdown-Tabelle (| ... |)
    if (/^\|.+\|$/.test(trimmed)) {
      flushList();
      flushClause();
      flushParagraph();
      flushQuote();
      tableLines.push(trimmed);
      continue;
    }

    // Satzungs-Absatz wie **(1)** ... oder **(3) „Angesetzt“** ...
    const clauseMatch = trimmed.match(/^\*\*\((\d+[a-z]?)\)(?:\s+([^*]+))?\*\*\s*(.*)$/);
    if (clauseMatch) {
      flushAll();
      activeClause = {
        num: clauseMatch[1],
        leadBold: clauseMatch[2] ? clauseMatch[2].trim() : "",
        textLines: clauseMatch[3] ? [clauseMatch[3]] : [],
        extraHtml: [],
      };
      continue;
    }

    // Fortsetzung einer laufenden Zeile
    flushList();
    flushQuote();
    flushTable();
    if (activeClause && activeClause.extraHtml.length > 0) {
      flushClause();
    }
    if (activeClause) {
      activeClause.textLines.push(trimmed);
    } else {
      paragraphLines.push(trimmed);
    }
  }

  flushAll();
  return out.join("");
}

function parseSatzungDocument(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  let docTitle = "Schiedsrichtersatzung";
  let titleFound = false;
  const introLines = [];
  const sections = [];
  let currentSection = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!titleFound && /^#\s+(.+)$/.test(trimmed)) {
      docTitle = trimmed.replace(/^#\s+/, "").trim();
      titleFound = true;
      continue;
    }

    const h2Match = trimmed.match(/^##\s+(.+)$/);
    if (h2Match) {
      const fullHeading = h2Match[1].trim();
      const paraMatch = fullHeading.match(/^(§+\s*\d+[a-z]?)\s+(.+)$/i);
      const id = `satzung-sec-${sections.length + 1}`;
      currentSection = {
        id,
        fullHeading,
        badge: paraMatch ? paraMatch[1].trim() : null,
        title: paraMatch ? paraMatch[2].trim() : fullHeading,
        lines: [],
      };
      sections.push(currentSection);
      continue;
    }

    if (currentSection) {
      currentSection.lines.push(line);
    } else {
      introLines.push(line);
    }
  }

  return { docTitle, introLines, sections };
}

async function loadSatzung(silent = false) {
  if (!silent) {
    state.satzungLoading = true;
    state.satzungError = null;
    render();
  }
  try {
    const res = await fetch("/api/satzung", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json.error || "Satzung konnte nicht geladen werden.");
    }
    state.satzungMarkdown = json.markdown || "";
    state.satzungUpdatedAt = json.updatedAt || null;
    state.satzungError = null;
  } catch (err) {
    state.satzungError = err.message;
  } finally {
    state.satzungLoading = false;
    render();
  }
}

function renderSatzungTab() {
  if (state.satzungMarkdown === null && !state.satzungLoading && !state.satzungError) {
    loadSatzung(true);
    return `<div class="card" style="padding:28px;text-align:center;color:var(--muted)">Schiedsrichtersatzung wird geladen …</div>`;
  }

  if (state.satzungLoading && state.satzungMarkdown === null) {
    return `<div class="card" style="padding:28px;text-align:center;color:var(--muted)">Schiedsrichtersatzung wird geladen …</div>`;
  }

  if (state.satzungError && state.satzungMarkdown === null) {
    return `
      <div class="alert alert-danger">
        ${esc(state.satzungError)}
        <div style="margin-top:8px">
          <button class="btn btn-outline btn-sm" onclick="loadSatzung()">Erneut versuchen</button>
        </div>
      </div>
    `;
  }

  const { docTitle, introLines, sections } = parseSatzungDocument(state.satzungMarkdown || "");
  const q = (state.satzungSearch || "").trim().toLowerCase();

  const filteredSections = q
    ? sections.filter(
        (sec) =>
          sec.fullHeading.toLowerCase().includes(q) ||
          sec.lines.join("\n").toLowerCase().includes(q)
      )
    : sections;

  const introHtml = renderMarkdownBlocksHtml(introLines, state.satzungSearch);
  const updatedStr = state.satzungUpdatedAt
    ? new Date(state.satzungUpdatedAt).toLocaleDateString("de-DE", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : null;

  return `
    <div class="bylaw-page">
      <header class="bylaw-hero">
        <div class="bylaw-hero-top">
          <span class="bylaw-kicker">📜 Verbindliches Regelwerk</span>
          ${updatedStr ? `<span class="bylaw-meta">Stand der Datei: ${esc(updatedStr)}</span>` : ""}
        </div>
        <h2 class="bylaw-doc-title">${esc(docTitle)}</h2>
        <div class="bylaw-search-row">
          <input
            id="satzung-search-input"
            type="search"
            class="bylaw-search-input"
            placeholder="In der Satzung suchen (z. B. 48 Stunden, 15,00 Euro, Kader, Härtefall …)"
            value="${esc(state.satzungSearch)}"
            oninput="setSatzungSearch(this.value, this.selectionStart)"
            aria-label="In der Satzung suchen"
          />
          ${
            state.satzungSearch
              ? `<button type="button" class="btn btn-outline btn-sm bylaw-clear-btn" onclick="setSatzungSearch('')">Zurücksetzen</button>`
              : ""
          }
        </div>
      </header>

      ${
        sections.length > 0
          ? `
            <nav class="bylaw-mobile-pills" aria-label="Paragraphen-Schnellwahl">
              ${filteredSections
                .map(
                  (sec) => `
                    <button type="button" class="bylaw-jump-pill" onclick="scrollToBylawSection('${sec.id}')">
                      ${esc(sec.badge || sec.title)}
                    </button>
                  `
                )
                .join("")}
            </nav>
          `
          : ""
      }

      <div class="bylaw-layout">
        ${
          sections.length > 0
            ? `
              <aside class="bylaw-toc-card" aria-label="Inhaltsverzeichnis">
                <div class="bylaw-toc-heading">Inhaltsverzeichnis</div>
                <nav class="bylaw-toc-list">
                  ${filteredSections
                    .map(
                      (sec) => `
                        <button type="button" class="bylaw-toc-link" onclick="scrollToBylawSection('${sec.id}')">
                          ${sec.badge ? `<span class="bylaw-toc-badge">${esc(sec.badge)}</span>` : ""}
                          <span class="bylaw-toc-title">${esc(sec.title)}</span>
                        </button>
                      `
                    )
                    .join("")}
                </nav>
              </aside>
            `
            : ""
        }

        <div class="bylaw-content-col">
          ${
            introHtml && !q
              ? `<section class="card bylaw-section-card">${introHtml}</section>`
              : ""
          }
          ${
            filteredSections.length === 0
              ? `<div class="card" style="padding:28px;text-align:center;color:var(--muted)">Keine Paragraphen für „${esc(state.satzungSearch)}“ gefunden.</div>`
              : filteredSections
                  .map(
                    (sec) => `
                      <section class="card bylaw-section-card" id="${sec.id}">
                        <header class="bylaw-section-header">
                          ${sec.badge ? `<span class="bylaw-section-badge">${esc(sec.badge)}</span>` : ""}
                          <h3 class="bylaw-section-title">${renderInlineMarkdown(sec.title, state.satzungSearch)}</h3>
                        </header>
                        <div class="bylaw-section-body">
                          ${renderMarkdownBlocksHtml(sec.lines, state.satzungSearch)}
                        </div>
                      </section>
                    `
                  )
                  .join("")
          }
        </div>
      </div>
    </div>
  `;
}

function renderDocsTab() {
  const gameMap = new Map(state.data.games.map((g) => [g.id, g]));
  const chainMap = new Map();
  for (const g of state.data.games) {
    for (const ch of g.chains) chainMap.set(ch.id, ch);
  }
  return `
    <h2 style="margin-top:0;font-size:1.1rem">Dokumentations-Protokoll (§ 6 Abs. 1)</h2>
    <div class="card" style="overflow-x:auto">
      <table>
        <thead>
          <tr><th>Zeitpunkt</th><th>ID</th><th>Spiel</th><th>Vorgang</th><th>Von</th><th>An</th><th>Hinweis</th></tr>
        </thead>
        <tbody>
          ${state.data.events
            .map((ev) => {
              const g = gameMap.get(ev.game_id);
              const ch = chainMap.get(ev.chain_id);
              return `
                <tr>
                  <td style="white-space:nowrap">${formatDate(ev.created_at)}</td>
                  <td><span class="badge badge-gray">${esc(ch?.ref_code || "–")}</span></td>
                  <td>${g ? esc(g.title) : ev.game_id}</td>
                  <td><span class="badge badge-gray">${esc(ev.event_type)}</span></td>
                  <td>${ev.fromUser ? esc(fullName(ev.fromUser)) : "–"}</td>
                  <td>${ev.toUser ? esc(fullName(ev.toUser)) : "–"}</td>
                  <td>${esc(ev.public_note || "")} ${ev.is_short_notice ? `<span class="badge badge-amber">&lt;48h</span>` : ""}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderPodiumCard({ icon, title, subtitle, badgeName, items, formatVal, isJackpot, getScore }) {
  if (!items || items.length === 0) {
    return `
      <div class="podium-card">
        <div class="podium-card-header">
          <span class="podium-card-icon">${icon}</span>
          <div>
            <h3 class="podium-card-title">${title}</h3>
            <div class="podium-card-sub">${subtitle}</div>
          </div>
        </div>
        <div style="padding:28px 12px;text-align:center;color:var(--muted);font-size:0.85rem">
          Noch keine Einträge in dieser Kategorie erfasst.
        </div>
      </div>
    `;
  }

  // Calculate ranks handling ties
  const scoreFn = getScore || ((item) => (isJackpot ? item.ch.payout_pool_cents : formatVal(item)));
  let currentRank = 1;
  const rankedItems = items.map((item, idx) => {
    if (idx > 0) {
      const prevScore = scoreFn(items[idx - 1]);
      const currScore = scoreFn(item);
      if (currScore !== prevScore) {
        currentRank = idx + 1;
      }
    } else {
      currentRank = 1;
    }
    return { item, rank: currentRank };
  });

  const champions = rankedItems.filter((r) => r.rank === 1);
  const runners = rankedItems.filter((r) => r.rank > 1);

  let champHtml = "";
  if (champions.length === 1) {
    const champ = champions[0].item;
    const champName = isJackpot
      ? `${champ.g.title} (${champ.ch.ref_code || `Slot ${champ.ch.slot_number}`})`
      : `${champ.last_name}, ${champ.first_name}`;
    const champVal = isJackpot
      ? formatEuro(champ.ch.payout_pool_cents)
      : formatVal(champ);
    const champSub = isJackpot
      ? (champ.ch.currentAssignee ? `Gepfiffen: ${champ.ch.currentAssignee.last_name}, ${champ.ch.currentAssignee.first_name}` : "Status: Offen")
      : badgeName;

    const clickAttr = isJackpot
      ? (champ.ch.current_assignee_id ? `onclick="openPlayerDetailModal(${champ.ch.current_assignee_id})" role="button" tabindex="0"` : "")
      : `onclick="openPlayerDetailModal(${champ.id})" role="button" tabindex="0"`;
    const clickClass = (isJackpot ? champ.ch.current_assignee_id : true) ? "stats-clickable" : "";

    champHtml = `
      <div class="podium-champion ${clickClass}" ${clickAttr} title="Details zu ${esc(champName)} anzeigen">
        <div class="champion-crown">🥇</div>
        <div class="champion-info">
          <div class="champion-name" title="${esc(champName)}">${esc(champName)}</div>
          <div class="champion-badge">${esc(champSub)}</div>
        </div>
        <div class="champion-val">${esc(champVal)}</div>
      </div>
    `;
  } else {
    // Multiple champions tied for Rank 1
    const sharedVal = isJackpot
      ? formatEuro(champions[0].item.ch.payout_pool_cents)
      : formatVal(champions[0].item);

    champHtml = `
      <div class="podium-champion-multi">
        <div class="champion-multi-header">
          <span style="font-size:1.15rem">🥇</span>
          <span><strong>Platz 1 (Geteilt - ${champions.length} Spieler)</strong></span>
          <span class="badge badge-gold" style="margin-left:auto">${esc(sharedVal)}</span>
        </div>
        <div class="champion-multi-list">
          ${champions
            .map((c) => {
              const name = isJackpot
                ? `${c.item.g.title} (${c.item.ch.ref_code || `Slot ${c.item.ch.slot_number}`})`
                : `${c.item.last_name}, ${c.item.first_name}`;
              const sub = isJackpot
                ? (c.item.ch.currentAssignee ? `Gepfiffen: ${c.item.ch.currentAssignee.last_name}, ${c.item.ch.currentAssignee.first_name}` : "Status: Offen")
                : badgeName;
              const clickAttr = isJackpot
                ? (c.item.ch.current_assignee_id ? `onclick="openPlayerDetailModal(${c.item.ch.current_assignee_id})" role="button" tabindex="0"` : "")
                : `onclick="openPlayerDetailModal(${c.item.id})" role="button" tabindex="0"`;
              const clickClass = (isJackpot ? c.item.ch.current_assignee_id : true) ? "stats-clickable" : "";
              return `
                <div class="champion-multi-item ${clickClass}" ${clickAttr} title="Details zu ${esc(name)} anzeigen">
                  <span class="champion-multi-bullet">🏆</span>
                  <div style="flex:1;min-width:0">
                    <span class="champion-multi-name" title="${esc(name)}">${esc(name)}</span>
                    <span class="champion-multi-sub"> &bull; ${esc(sub)}</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  let runnersHtml = "";
  if (runners.length > 0) {
    const displayedRunners = runners.slice(0, 8);
    const hiddenCount = runners.length - displayedRunners.length;
    runnersHtml = `
      <div class="podium-runners">
        ${displayedRunners
          .map(({ item, rank }) => {
            const rankIcon = rank === 2 ? "🥈 2." : rank === 3 ? "🥉 3." : `${rank}.`;
            const name = isJackpot
              ? `${item.g.title} (${item.ch.ref_code || `Slot ${item.ch.slot_number}`})`
              : `${item.last_name}, ${item.first_name}`;
            const val = isJackpot
              ? formatEuro(item.ch.payout_pool_cents)
              : formatVal(item);
            const clickAttr = isJackpot
              ? (item.ch.current_assignee_id ? `onclick="openPlayerDetailModal(${item.ch.current_assignee_id})" role="button" tabindex="0"` : "")
              : `onclick="openPlayerDetailModal(${item.id})" role="button" tabindex="0"`;
            const clickClass = (isJackpot ? item.ch.current_assignee_id : true) ? "stats-clickable" : "";
            return `
              <div class="runner-row ${clickClass}" ${clickAttr} title="Details zu ${esc(name)} anzeigen">
                <span class="runner-rank" style="min-width:44px;font-size:0.8rem">${rankIcon}</span>
                <span class="runner-name" title="${esc(name)}">${esc(name)}</span>
                <span class="runner-val">${esc(val)}</span>
              </div>
            `;
          })
          .join("")}
        ${hiddenCount > 0 ? `<div style="font-size:0.75rem;color:var(--muted);text-align:center;padding:6px 0">+ ${hiddenCount} weitere Spieler in Gesamt-Tabelle</div>` : ""}
      </div>
    `;
  }

  return `
    <div class="podium-card">
      <div class="podium-card-header">
        <span class="podium-card-icon">${icon}</span>
        <div>
          <h3 class="podium-card-title">${title}</h3>
          <div class="podium-card-sub">${subtitle}</div>
        </div>
      </div>
      ${champHtml}
      ${runnersHtml}
    </div>
  `;
}

function renderStatsTab() {
  const currentSeason = state.data.season;
  const isAllTime = currentSeason?.id === "all";
  const players = state.data.players || [];
  const games = state.data.games || [];
  const activeSeason =
    state.data.seasons?.find((s) => s.is_active) || state.data.seasons?.[0];

  // 1. Top Einsatzkönige
  const byDeployed = [...players]
    .filter((p) => p.deployedCount > 0)
    .sort((a, b) => b.deployedCount - a.deployedCount || a.last_name.localeCompare(b.last_name, "de"));

  // 2. Top Topfjäger
  const byEarned = [...players]
    .filter((p) => (p.earnedPayoutCents || 0) > 0)
    .sort((a, b) => (b.earnedPayoutCents || 0) - (a.earnedPayoutCents || 0) || a.last_name.localeCompare(b.last_name, "de"));

  // 3. Höchste Töpfe (Jackpot-Spiele)
  const poolChains = [];
  for (const g of games) {
    for (const ch of g.chains || []) {
      if (ch.payout_pool_cents > 0) {
        poolChains.push({ g, ch });
      }
    }
  }
  poolChains.sort(
    (a, b) =>
      b.ch.payout_pool_cents - a.ch.payout_pool_cents ||
      new Date(b.g.kickoff_at).getTime() - new Date(a.g.kickoff_at).getTime()
  );

  // 4. Team-Retter (Meiste Übernahmen)
  const byTakeovers = [...players]
    .filter((p) => (p.takeoverCount || 0) > 0)
    .sort((a, b) => (b.takeoverCount || 0) - (a.takeoverCount || 0) || a.last_name.localeCompare(b.last_name, "de"));

  // 5. Staffelläufer (Meiste Weitergaben)
  const byHandoffs = [...players]
    .filter((p) => (p.handoffCount || 0) > 0)
    .sort((a, b) => (b.handoffCount || 0) - (a.handoffCount || 0) || a.last_name.localeCompare(b.last_name, "de"));

  // Spitzenreiter für Badges (alle Spieler mit Höchstwert erhalten das Badge!)
  const maxDeployed = byDeployed.length > 0 ? byDeployed[0].deployedCount : 0;
  const topDeployedIds = new Set(
    maxDeployed > 0 ? byDeployed.filter((p) => p.deployedCount === maxDeployed).map((p) => p.id) : []
  );

  const maxEarned = byEarned.length > 0 ? (byEarned[0].earnedPayoutCents || 0) : 0;
  const topEarnedIds = new Set(
    maxEarned > 0 ? byEarned.filter((p) => (p.earnedPayoutCents || 0) === maxEarned).map((p) => p.id) : []
  );

  const maxTakeover = byTakeovers.length > 0 ? (byTakeovers[0].takeoverCount || 0) : 0;
  const topTakeoverIds = new Set(
    maxTakeover > 0 ? byTakeovers.filter((p) => (p.takeoverCount || 0) === maxTakeover).map((p) => p.id) : []
  );

  const maxHandoff = byHandoffs.length > 0 ? (byHandoffs[0].handoffCount || 0) : 0;
  const topHandoffIds = new Set(
    maxHandoff > 0 ? byHandoffs.filter((p) => (p.handoffCount || 0) === maxHandoff).map((p) => p.id) : []
  );

  // Helper für Rang-Vergleich in Gesamt-Tabelle
  function getSortValue(p, mode) {
    if (mode === "earned") return p.earnedPayoutCents || 0;
    if (mode === "takeovers") return p.takeoverCount || 0;
    if (mode === "handoffs") return p.handoffCount || 0;
    return p.deployedCount || 0;
  }

  // Filter & Sortierung für Gesamt-Tabelle
  let filteredPlayers = [...players];
  if (state.statsSearch && state.statsSearch.trim()) {
    const q = state.statsSearch.trim().toLowerCase();
    filteredPlayers = filteredPlayers.filter(
      (p) =>
        `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) ||
        p.email.toLowerCase().includes(q)
    );
  }

  const sortMode = state.statsSort || "deployed";
  filteredPlayers.sort((a, b) => {
    if (sortMode === "earned") {
      return (b.earnedPayoutCents || 0) - (a.earnedPayoutCents || 0) || b.deployedCount - a.deployedCount;
    } else if (sortMode === "takeovers") {
      return (b.takeoverCount || 0) - (a.takeoverCount || 0) || b.deployedCount - a.deployedCount;
    } else if (sortMode === "handoffs") {
      return (b.handoffCount || 0) - (a.handoffCount || 0) || b.deployedCount - a.deployedCount;
    } else {
      return b.deployedCount - a.deployedCount || (b.earnedPayoutCents || 0) - (a.earnedPayoutCents || 0);
    }
  });

  let currentTableRank = 1;
  const tableRows =
    filteredPlayers.length === 0
      ? `<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px">Keine Spieler gefunden.</td></tr>`
      : filteredPlayers
          .map((p, idx) => {
            if (idx > 0) {
              const prevVal = getSortValue(filteredPlayers[idx - 1], sortMode);
              const currVal = getSortValue(p, sortMode);
              if (currVal !== prevVal) {
                currentTableRank = idx + 1;
              }
            } else {
              currentTableRank = 1;
            }

            const isMe = p.id === state.user.id;
            let badgesHtml = "";
            if (topDeployedIds.has(p.id))
              badgesHtml += `<span class="stats-badge-tag stats-badge-gold" title="Meiste gepfiffene Spiele">🏆 Einsatzkönig</span>`;
            if (topEarnedIds.has(p.id))
              badgesHtml += `<span class="stats-badge-tag stats-badge-green" title="Höchster Prämien-Verdienst">💰 Cash-King</span>`;
            if (topTakeoverIds.has(p.id))
              badgesHtml += `<span class="stats-badge-tag stats-badge-blue" title="Meiste Einsätze gerettet">🛡️ Retter</span>`;
            if (topHandoffIds.has(p.id))
              badgesHtml += `<span class="stats-badge-tag stats-badge-purple" title="Meiste Ansetzungen weitergegeben">🏃 Staffel</span>`;

            return `
              <tr class="stats-row-clickable has-mobile-accordion ${isMe ? "stats-row-current-user" : ""}" id="stats-row-${p.id}" onclick="if(!event.target.closest('.mobile-accordion-toggle')) openPlayerDetailModal(${p.id})" title="Details zu ${esc(fullName(p))} anzeigen">
                <td data-label="#"><strong>${currentTableRank}</strong></td>
                <td data-label="Spieler" class="cell-main">
                  <div>
                    <strong style="color:var(--text);text-decoration:underline;text-decoration-color:rgba(0,0,0,0.2)">${esc(p.last_name)}, ${esc(p.first_name)}</strong>
                    ${isMe ? `<span class="badge badge-gold" style="font-size:0.7rem;margin-left:4px">Du</span>` : ""}
                    ${badgesHtml}
                  </div>
                  <div class="player-meta">${roleLabel(p.role)} &bull; ${esc(p.email)}</div>
                </td>
                <td data-label="Gepfiffen">
                  <strong>${p.deployedCount}</strong> ${p.deployedCount === 1 ? "Spiel" : "Spiele"}
                  ${p.isDeployedOverridden ? `<span class="badge badge-gray" style="font-size:0.68rem" title="Manuell angepasst">korr.</span>` : ""}
                </td>
                <td data-label="Topf-Verdienst" style="color:var(--success);font-weight:700">
                  ${p.earnedPayoutCents > 0 ? formatEuro(p.earnedPayoutCents) : "0,00 €"}
                  ${p.isEarnedOverridden ? `<span class="badge badge-gray" style="font-size:0.68rem;font-weight:normal" title="Manuell angepasst">korr.</span>` : ""}
                </td>
                <td data-label="Übernahmen" class="mobile-secondary">
                  ${p.takeoverCount > 0 ? `<strong style="color:var(--info)">${p.takeoverCount}×</strong> gerettet` : `<span style="color:var(--muted)">0</span>`}
                  ${p.isTakeoverOverridden ? `<span class="badge badge-gray" style="font-size:0.68rem" title="Manuell angepasst">korr.</span>` : ""}
                </td>
                <td data-label="Weitergaben" class="mobile-secondary">
                  ${p.handoffCount > 0 ? `<span style="color:var(--warn);font-weight:600">${p.handoffCount}×</span> weitergegeben` : `<span style="color:var(--muted)">0</span>`}
                  ${p.isHandoffOverridden ? `<span class="badge badge-gray" style="font-size:0.68rem" title="Manuell angepasst">korr.</span>` : ""}
                </td>
                <td data-label="Offen" class="mobile-secondary">
                  ${p.openPaymentCents > 0 ? `<strong style="color:var(--danger)">${formatEuro(p.openPaymentCents)}</strong>` : "0,00 €"}
                </td>
                <td style="padding:0;border:none">
                  <button type="button" class="mobile-accordion-toggle" onclick="event.stopPropagation(); toggleMobileAccordion('stats-row-${p.id}', this)">
                    <span>Übernahmen &amp; Saldo</span> <span class="acc-arrow">▾</span>
                  </button>
                </td>
              </tr>
            `;
          })
          .join("");

  return `
    <div class="stats-header-wrap">
      <div>
        <h2 style="margin:0;font-size:1.15rem">🏆 Hall of Fame &amp; Rangliste</h2>
        <div style="font-size:0.85rem;color:var(--muted);margin-top:2px">
          ${
            isAllTime
              ? "Ewige Bestenliste über alle Saisons hinweg"
              : `Statistiken der Saison: <strong>${esc(currentSeason?.name || "Aktuell")}</strong>`
          }
        </div>
      </div>
      <div class="stats-time-toggle">
        <button class="stats-toggle-btn ${!isAllTime ? "active" : ""}" onclick="changeSeason(${activeSeason ? activeSeason.id : currentSeason?.id || 1})">
          Aktuelle Saison
        </button>
        <button class="stats-toggle-btn ${isAllTime ? "active" : ""}" onclick="changeSeason('all')">
          🏆 Ewige Tabelle
        </button>
      </div>
    </div>

    <div class="stats-grid">
      ${renderPodiumCard({
        icon: "🏆",
        title: "Einsatzkönige",
        subtitle: "Meiste gepfiffene Spiele",
        badgeName: "Einsatzkönig",
        items: byDeployed,
        getScore: (p) => p.deployedCount,
        formatVal: (p) => `${p.deployedCount} ${p.deployedCount === 1 ? "Spiel" : "Spiele"}`,
        isJackpot: false,
      })}

      ${renderPodiumCard({
        icon: "💰",
        title: "Topfjäger",
        subtitle: "Höchste verdiente Prämien",
        badgeName: "Cash-King",
        items: byEarned,
        getScore: (p) => p.earnedPayoutCents || 0,
        formatVal: (p) => formatEuro(p.earnedPayoutCents),
        isJackpot: false,
      })}

      ${renderPodiumCard({
        icon: "🎰",
        title: "Höchste Töpfe",
        subtitle: "Jackpot-Spiele der Saison",
        badgeName: "Top-Jackpot",
        items: poolChains,
        getScore: (item) => item.ch.payout_pool_cents || 0,
        formatVal: () => "",
        isJackpot: true,
      })}

      ${renderPodiumCard({
        icon: "🛡️",
        title: "Team-Retter",
        subtitle: "Meiste Übernahmen für andere",
        badgeName: "Team-Retter",
        items: byTakeovers,
        getScore: (p) => p.takeoverCount || 0,
        formatVal: (p) => `${p.takeoverCount}× gerettet`,
        isJackpot: false,
      })}

      ${renderPodiumCard({
        icon: "🏃",
        title: "Staffelläufer",
        subtitle: "Meiste Weiterleitungen",
        badgeName: "Staffelläufer",
        items: byHandoffs,
        getScore: (p) => p.handoffCount || 0,
        formatVal: (p) => `${p.handoffCount}× weitergegeben`,
        isJackpot: false,
      })}
    </div>

    <div class="card" style="margin-top:20px;overflow-x:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
        <h3 style="margin:0;font-size:1.05rem">Vollständige Mannschafts-Tabelle</h3>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <input
            type="text"
            id="stats-search-input"
            placeholder="Spieler suchen..."
            value="${esc(state.statsSearch || "")}"
            oninput="setStatsSearch(this.value, this.selectionStart)"
            style="width:180px;padding:6px 10px;font-size:0.84rem;border:1px solid #d1ccc0;border-radius:6px"
          />
          <select
            onchange="setStatsSort(this.value)"
            style="padding:6px 10px;font-size:0.84rem;border:1px solid #d1ccc0;border-radius:6px"
          >
            <option value="deployed" ${sortMode === "deployed" ? "selected" : ""}>Sortierung: Meiste Einsätze</option>
            <option value="earned" ${sortMode === "earned" ? "selected" : ""}>Sortierung: Meiste Prämien (€)</option>
            <option value="takeovers" ${sortMode === "takeovers" ? "selected" : ""}>Sortierung: Meiste Übernahmen</option>
            <option value="handoffs" ${sortMode === "handoffs" ? "selected" : ""}>Sortierung: Meiste Weitergaben</option>
          </select>
        </div>
      </div>

      <table class="responsive-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Spieler</th>
            <th>Gepfiffen</th>
            <th>Topf-Verdienst</th>
            <th>Übernahmen</th>
            <th>Weitergaben</th>
            <th>Offene Gebühren</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>
  `;
}

function renderModal() {
  if (!state.modal) return "";

  if (state.modal.type === "chat") {
    const waUrl = `https://wa.me/?text=${encodeURIComponent(state.modal.chatMessage)}`;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">${esc(state.modal.title)}</h3>
          <p style="font-size:0.85rem;color:var(--muted)">
            Gemäß §§ 4–6 ist dieser Vorgang im Gruppenchat der zweiten Herrenmannschaft bekannt zu geben:
          </p>
          <div class="chat-pre" id="chat-msg-box">${esc(state.modal.chatMessage)}</div>
          <div class="btn-row">
            <button class="btn btn-primary" onclick="copyChatMsg()">Text kopieren</button>
            <a class="btn btn-success" href="${waUrl}" target="_blank" rel="noopener" style="text-decoration:none">In WhatsApp teilen</a>
            <button class="btn btn-outline" onclick="closeModal()">Schließen</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "handoff") {
    const { chain, game, isShortNotice } = state.modal;
    const isPending = chain.status === "PENDING_HANDOFF";
    const actor = isPending ? chain.pendingAssignee : chain.currentAssignee;
    const isExempt = actor ? actor.is_volunteer_exempt : state.user.is_volunteer_exempt;
    const canSelectPlayer = state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN";
    const currentResponsibleId = actor ? actor.id : null;
    const playerOpts = canSelectPlayer
      ? state.data.players
          .filter((p) => p.is_active_in_list && p.id !== currentResponsibleId)
          .map((p) => `<option value="${p.id}">${esc(p.last_name)}, ${esc(p.first_name)}</option>`)
          .join("")
      : "";

    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Schiedsrichter-Weitergabe (§ 4)</h3>
          <p style="font-size:0.86rem;color:var(--muted)">${esc(game.title)} (${formatDate(game.kickoff_at)}, Slot ${chain.slot_number})</p>
          ${isShortNotice ? `<div class="alert alert-warn">Achtung: Weniger als 48 Stunden bis Spielbeginn (§ 4 Abs. 2). Bitte kurzen Verhinderungsgrund angeben.</div>` : ""}
          <form id="handoff-form">
            <div class="form-group">
              <label>Art der Weitergabe</label>
              <select id="hf-reason" onchange="toggleHardshipField()">
                <option value="REGULAR">Weitergabe mit Zahlung (15,00 €: 10 € Topf / 5 € Mannschaftskasse)</option>
                <option value="SQUAD_NOMINATION">Kaderung für dieses Spiel (§ 3 Abs. 5 – 0,00 €)</option>
                <option value="HARDSHIP">Weitergabe mit begründetem Härtefall (§ 8 – vertraulich an Kassenwart)</option>
                ${isExempt ? `<option value="VOLUNTEER_EXEMPT">Weitergabe ohne Kosten wg. Ehrenamt (§ 7 – 0,00 €)</option>` : ""}
              </select>
            </div>
            ${
              canSelectPlayer
                ? `
              <div class="form-group" style="background:var(--card-bg, #f8fafc);padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px">
                <label style="font-weight:600;font-size:0.86rem;display:flex;align-items:center;gap:6px">
                  <span>🎯 Empfänger festlegen (Schiriwart/Admin)</span>
                </label>
                <select id="hf-target" style="margin-top:4px">
                  <option value="">Automatisch (nach Rotationsliste § 3)</option>
                  ${playerOpts}
                </select>
                <div style="font-size:0.75rem;color:var(--muted);margin-top:4px">
                  Standardmäßig wird die nächste freie Person nach Einsatzliste ermittelt. Du kannst hier aber auch gezielt einen Spieler bestimmen.
                </div>
              </div>
            `
                : ""
            }
            <div class="form-group">
              <label>Öffentlicher Hinweis (optional, Pflicht bei &lt; 48h)</label>
              <input type="text" id="hf-note" placeholder="z. B. Beruflich verhindert / Zugausfall" />
            </div>
            <div class="form-group" id="hf-hardship-wrap" style="display:none">
              <label>Vertrauliche Begründung für den Kassenwart (§ 8 Abs. 2 &amp; 4)</label>
              <textarea id="hf-hardship" rows="3" placeholder="Nur für den Mannschaftskassenwart sichtbar..."></textarea>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Weitergeben</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "addGame") {
    const playerOpts = state.data.players
      .filter((p) => p.is_active_in_list)
      .map((p) => `<option value="${p.id}">${esc(p.last_name)}, ${esc(p.first_name)}</option>`)
      .join("");
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Neues Hallenspiel ansetzen (§ 3)</h3>
          <form id="add-game-form">
            <div class="form-group">
              <label>Spieltitel</label>
              <input type="text" id="gm-title" required placeholder="z. B. RHTC II vs. Harvestehude III" />
            </div>
            <div class="form-group">
              <label>Halle / Ort</label>
              <input type="text" id="gm-loc" value="RHTC Halle" />
            </div>
            <div class="form-group">
              <label>Anpfiff</label>
              <input type="datetime-local" id="gm-kickoff" required />
            </div>
            <div class="form-group" style="background:var(--card-bg, #f8fafc);padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px">
              <label style="font-weight:600;display:flex;align-items:center;cursor:pointer">
                <input type="checkbox" id="gm-assign" checked style="width:auto;margin-right:8px" onchange="document.getElementById('gm-assign-opts').style.display=this.checked?'block':'none'" />
                Schiedsrichter direkt zuweisen (§ 3)
              </label>
              <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
                Wenn deaktiviert, wird das Spiel mit offenen Slots angelegt (keine Spieler zugewiesen).
              </div>
            </div>
            <div id="gm-assign-opts" style="margin-bottom:10px">
              <div class="form-group">
                <label><input type="checkbox" id="gm-first" style="width:auto;margin-right:6px" onchange="document.getElementById('gm-first-opts').style.display=this.checked?'block':'none'" /> Erstes Spiel der Saison (Losverfahren / Auswahl nach § 3 Abs. 3)</label>
              </div>
              <div id="gm-first-opts" style="display:none;background:#f8fafc;padding:10px;border-radius:8px;margin-bottom:10px">
                <label><input type="checkbox" id="gm-random" checked style="width:auto;margin-right:6px" /> Erste 2 Schiedsrichter automatisch auslosen</label>
                <div class="grid-2" style="margin-top:8px">
                  <div class="form-group"><label>Slot 1 (falls manuell)</label><select id="gm-r1"><option value="">Automatisch</option>${playerOpts}</select></div>
                  <div class="form-group"><label>Slot 2 (falls manuell)</label><select id="gm-r2"><option value="">Automatisch</option>${playerOpts}</select></div>
                </div>
              </div>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Spiel anlegen</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "editGame") {
    const g = state.modal.game;
    const d = new Date(g.kickoff_at);
    const localIso = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Spiel bearbeiten</h3>
          <form id="edit-game-form">
            <div class="form-group">
              <label>Spieltitel</label>
              <input type="text" id="eg-title" value="${esc(g.title)}" required />
            </div>
            <div class="form-group">
              <label>Halle / Ort</label>
              <input type="text" id="eg-loc" value="${esc(g.location)}" />
            </div>
            <div class="form-group">
              <label>Anpfiff</label>
              <input type="datetime-local" id="eg-kickoff" value="${localIso}" required />
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Änderungen speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "manualAssign") {
    const { chain, game } = state.modal;
    const playerOpts = state.data.players
      .map(
        (p) =>
          `<option value="${p.id}" ${chain.current_assignee_id === p.id ? "selected" : ""}>${esc(p.last_name)}, ${esc(p.first_name)}${p.is_active_in_list ? "" : " (ausgenommen)"}</option>`
      )
      .join("");
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Schiedsrichter manuell zuweisen (§ 2 Abs. 4)</h3>
          <p style="font-size:0.86rem;color:var(--muted)">${esc(game.title)} (${formatDate(game.kickoff_at)}, Slot ${chain.slot_number})</p>
          <form id="manual-assign-form">
            <div class="form-group">
              <label>Spieler auswählen</label>
              <select id="ma-user" required>${playerOpts}</select>
            </div>
            <div class="form-group">
              <label>Ziel-Status</label>
              <select id="ma-status">
                <option value="ASSIGNED">Zugewiesen (unbestätigt)</option>
                <option value="CONFIRMED">Ansetzung zugesagt (Termin bestätigt)</option>
              </select>
            </div>
            <div class="form-group">
              <label>Begründung / Hinweis für Dokumentation (optional)</label>
              <input type="text" id="ma-note" placeholder="z. B. Korrektur nach Absprache" />
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Zuweisung speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "editSeason") {
    const s = state.modal.season;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Saisonnamen bearbeiten</h3>
          <form id="edit-season-form">
            <div class="form-group">
              <label>Saison-Bezeichnung</label>
              <input type="text" id="es-name" value="${esc(s.name)}" required />
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Speichern</button>
              ${(state.data?.seasons?.length || 0) > 1 ? `<button type="button" class="btn btn-danger" onclick="closeModal();deleteSeason(${s.id}, '${esc(s.name)}')">Saison löschen</button>` : ""}
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "addSeason") {
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Neue Saison anlegen</h3>
          <form id="add-season-form">
            <div class="form-group">
              <label>Saison-Bezeichnung</label>
              <input type="text" id="sn-name" required placeholder="z. B. Feldsaison 2027 oder Hallensaison 2027/28" />
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="sn-active" checked style="width:auto;margin-right:6px" /> Direkt als aktive Saison setzen</label>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Saison anlegen</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "importGamesCsv") {
    const m = state.modal;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Spielplan per CSV-Datei importieren (§ 3)</h3>
          <p style="font-size:0.84rem;color:var(--muted)">
            Erwartete Spalten (getrennt durch <code>;</code> oder <code>,</code>):<br>
            <strong>Titel;Datum;Uhrzeit;Ort</strong> (Datum als <code>TT.MM.JJJJ</code> oder <code>JJJJ-MM-TT</code>, Ort optional)<br>
            Beispiel: <code>RHTC II vs. HTHC III;29.11.2026;14:30;RHTC Halle</code>
          </p>
          <div class="form-group">
            <label>CSV-Datei auswählen</label>
            <input type="file" accept=".csv,text/csv" onchange="handleGamesCsvFile(this)" />
          </div>
          <div class="form-group" style="background:var(--card-bg, #f8fafc);padding:10px 12px;border:1px solid var(--border,#e2e8f0);border-radius:6px;margin-bottom:12px">
            <label style="font-weight:600;display:flex;align-items:center;cursor:pointer">
              <input type="checkbox" id="ig-assign" checked style="width:auto;margin-right:8px" onchange="const r=document.getElementById('ig-random-wrap'); if(r) r.style.display=this.checked?'block':'none'" />
              Schiedsrichter beim Import automatisch einteilen (§ 3)
            </label>
            <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">
              Wenn deaktiviert, werden alle Spiele als offene Termine ohne zugewiesene Schiedsrichter importiert.
            </div>
          </div>
          ${
            state.data.games.length === 0
              ? `<div class="form-group" id="ig-random-wrap">
                  <label><input type="checkbox" id="ig-random" checked style="width:auto;margin-right:6px" /> Erstes Spiel der Saison per Losverfahren besetzen (§ 3 Abs. 3)</label>
                </div>`
              : ""
          }
          ${m.fileName ? `<div class="alert alert-info">Datei: <strong>${esc(m.fileName)}</strong> &bull; ${m.parsedRows.length} gültige Spiele erkannt.</div>` : ""}
          ${
            m.result
              ? `<div class="alert ${m.result.errors?.length ? "alert-warn" : "alert-info"}">
                  <strong>Import abgeschlossen:</strong> ${m.result.createdCount} Spiele angelegt &amp; besetzt, ${m.result.skippedCount} übersprungen.
                  ${m.result.errors?.length ? `<ul style="margin:6px 0 0 18px;padding:0">${m.result.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
                </div>`
              : ""
          }
          <div class="btn-row">
            ${m.parsedRows.length > 0 ? `<button class="btn btn-primary" onclick="submitGamesCsvImport()">${m.parsedRows.length} Spiele importieren</button>` : ""}
            <button type="button" class="btn btn-outline" onclick="closeModal()">Schließen</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "importCsv") {
    const m = state.modal;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Spieler per CSV-Datei importieren</h3>
          <p style="font-size:0.84rem;color:var(--muted)">
            Erwartete Spalten (getrennt durch <code>;</code> oder <code>,</code>):<br>
            <strong>Vorname;Nachname;Email;Mobilnummer</strong> (optional: <code>;Rolle;Ehrenamt;Passwort</code>)<br>
            Beispiel: <code>Max;Mustermann;max@rhtc.de;0171 1234567;PLAYER;nein</code>
          </p>
          <div class="form-group">
            <label>CSV-Datei auswählen</label>
            <input type="file" accept=".csv,text/csv" onchange="handleCsvFile(this)" />
          </div>
          ${m.fileName ? `<div class="alert alert-info">Datei: <strong>${esc(m.fileName)}</strong> &bull; ${m.parsedRows.length} gültige Zeilen erkannt.</div>` : ""}
          ${
            m.result
              ? `<div class="alert ${m.result.errors?.length ? "alert-warn" : "alert-info"}">
                  <strong>Import abgeschlossen:</strong> ${m.result.createdCount} angelegt, ${m.result.skippedCount} übersprungen.
                  ${m.result.errors?.length ? `<ul style="margin:6px 0 0 18px;padding:0">${m.result.errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>` : ""}
                </div>`
              : ""
          }
          <div class="btn-row">
            ${m.parsedRows.length > 0 ? `<button class="btn btn-primary" onclick="submitCsvImport()">${m.parsedRows.length} Spieler importieren</button>` : ""}
            <button type="button" class="btn btn-outline" onclick="closeModal()">Schließen</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "addPlayer") {
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Neuen Spieler anlegen (§ 2)</h3>
          <form id="add-player-form">
            <div class="form-group"><label>Vorname</label><input id="pl-first" required /></div>
            <div class="form-group"><label>Nachname</label><input id="pl-last" required /></div>
            <div class="form-group"><label>E-Mail</label><input type="email" id="pl-email" required /></div>
            <div class="form-group"><label>Mobilnummer</label><input type="tel" id="pl-mobile" placeholder="z. B. 0171 1234567" /></div>
            <div class="grid-2">
              <div class="form-group"><label>IBAN (Bankverbindung)</label><input type="text" id="pl-iban" placeholder="DE..." /></div>
              <div class="form-group"><label>PayPal (E-Mail oder Link)</label><input type="text" id="pl-paypal" placeholder="z. B. paypal.me/name" /></div>
            </div>
            <div class="form-group"><label>Initial-Passwort</label><input id="pl-pass" value="rhtc2026" required /></div>
            <div class="form-group">
              <label>Rolle</label>
              <select id="pl-role">
                <option value="PLAYER">Spieler</option>
                <option value="SCHIEDSRICHTERWART">Schiedsrichterwart</option>
                <option value="KASSENWART">Mannschaftskassenwart</option>
                <option value="VORSTAND">Vorstand</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="pl-exempt" style="width:auto;margin-right:6px" /> Ehrenamtliche Befreiung (§ 7)</label>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "editPlayer") {
    const p = state.modal.player;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Spieler-Attribute bearbeiten (§ 2)</h3>
          <form id="edit-player-form">
            <div class="grid-2">
              <div class="form-group"><label>Vorname</label><input id="ep-first" value="${esc(p.first_name)}" required /></div>
              <div class="form-group"><label>Nachname</label><input id="ep-last" value="${esc(p.last_name)}" required /></div>
            </div>
            <div class="grid-2">
              <div class="form-group"><label>E-Mail</label><input type="email" id="ep-email" value="${esc(p.email)}" required /></div>
              <div class="form-group"><label>Mobilnummer</label><input type="tel" id="ep-mobile" value="${esc(p.mobile_number || "")}" placeholder="z. B. 0171 1234567" /></div>
            </div>
            <div class="grid-2">
              <div class="form-group"><label>IBAN (Bankverbindung)</label><input type="text" id="ep-iban" value="${esc(p.iban || "")}" placeholder="DE..." /></div>
              <div class="form-group"><label>PayPal (E-Mail oder Link)</label><input type="text" id="ep-paypal" value="${esc(p.paypal || "")}" placeholder="z. B. paypal.me/name" /></div>
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label>Rolle</label>
                <select id="ep-role">
                  <option value="PLAYER" ${p.role === "PLAYER" ? "selected" : ""}>Spieler</option>
                  <option value="SCHIEDSRICHTERWART" ${p.role === "SCHIEDSRICHTERWART" ? "selected" : ""}>Schiedsrichterwart</option>
                  <option value="KASSENWART" ${p.role === "KASSENWART" ? "selected" : ""}>Mannschaftskassenwart</option>
                  <option value="VORSTAND" ${p.role === "VORSTAND" ? "selected" : ""}>Vorstand</option>
                  <option value="ADMIN" ${p.role === "ADMIN" ? "selected" : ""}>Admin</option>
                </select>
              </div>
              <div class="form-group">
                <label>Listen-Position (§ 2 Abs. 4, optional)</label>
                <input type="number" id="ep-order" min="1" placeholder="Alphabetisch (leer)" value="${p.list_order_override ?? ""}" />
              </div>
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="ep-active" style="width:auto;margin-right:6px" ${p.is_active_in_list ? "checked" : ""} /> Aktiv in Schiedsrichterliste (§ 2 Abs. 4)</label>
            </div>
            <div class="form-group">
              <label><input type="checkbox" id="ep-exempt" style="width:auto;margin-right:6px" ${p.is_volunteer_exempt ? "checked" : ""} /> Ehrenamtliche Befreiung (§ 7)</label>
            </div>
            <div class="form-group">
              <label>Neues Passwort (optional, leer lassen = unverändert)</label>
              <div class="password-wrap">
                <input type="password" id="ep-pass" placeholder="Nur ausfüllen zum Zurücksetzen" autocomplete="new-password" />
                <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('ep-pass', this)" title="Passwort anzeigen">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Änderungen speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "profile") {
    const u = state.user;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Meine Stammdaten ändern</h3>
          <p style="font-size:0.85rem;color:var(--muted)">${esc(fullName(u))} (${roleLabel(u.role)})</p>
          <form id="profile-form">
            <div class="form-group">
              <label>E-Mail</label>
              <input type="email" id="prof-email" value="${esc(u.email)}" required />
            </div>
            <div class="form-group">
              <label>Mobilnummer</label>
              <input type="tel" id="prof-mobile" value="${esc(u.mobile_number || "")}" placeholder="z. B. 0171 1234567" />
            </div>
            <div class="grid-2">
              <div class="form-group">
                <label>IBAN (für Auszahlungen)</label>
                <input type="text" id="prof-iban" value="${esc(u.iban || "")}" placeholder="DE..." />
              </div>
              <div class="form-group">
                <label>PayPal (für Auszahlungen)</label>
                <input type="text" id="prof-paypal" value="${esc(u.paypal || "")}" placeholder="z. B. paypal.me/name" />
              </div>
            </div>
            <div class="form-group">
              <label>Neues Passwort (optional, leer lassen = unverändert)</label>
              <div class="password-wrap">
                <input type="password" id="prof-pass" placeholder="Neues Passwort eingeben" autocomplete="new-password" />
                <button type="button" class="password-toggle-btn" onclick="togglePasswordVisibility('prof-pass', this)" title="Passwort anzeigen">
                  ${EYE_OPEN_SVG}
                </button>
              </div>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Stammdaten speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "playerDetail") {
    const p = state.modal.player;
    const currentSeason = state.data.season;
    const isAllTime = currentSeason?.id === "all";
    const games = state.data.games || [];

    // Finde alle Einsätze/Spiele, bei denen p tatsächlich gepfiffen hat
    // (CONFIRMED_DEPLOYED oder REPORTED_DEPLOYED mit currentAssignee = p)
    const whistledChains = [];
    for (const g of games) {
      for (const ch of g.chains || []) {
        if (ch.current_assignee_id === p.id && (ch.status === "CONFIRMED_DEPLOYED" || ch.status === "REPORTED_DEPLOYED" || ch.payout_settled)) {
          whistledChains.push({ g, ch });
        }
      }
    }
    // Sortiere nach Datum absteigend
    whistledChains.sort((a, b) => new Date(b.g.kickoff_at).getTime() - new Date(a.g.kickoff_at).getTime());

    // Finde übernommene Einsätze (Retter): Event HANDOFF_ACCEPTED / VOLUNTEER_APPROVED mit to_user_id === p.id und from_user_id !== p.id
    const takeoverEvents = [];
    for (const g of games) {
      for (const ch of g.chains || []) {
        for (const ev of ch.events || []) {
          if (ev.to_user_id === p.id && (ev.event_type === "HANDOFF_ACCEPTED" || ev.event_type === "VOLUNTEER_APPROVED") && ev.from_user_id !== p.id) {
            takeoverEvents.push({ g, ch, ev });
          }
        }
      }
    }
    takeoverEvents.sort((a, b) => new Date(b.ev.created_at).getTime() - new Date(a.ev.created_at).getTime());

    // Finde weitergegebene Einsätze (Staffel): Event REGULAR_HANDOFF, HARDSHIP etc. mit from_user_id === p.id
    const handoffEvents = [];
    for (const g of games) {
      for (const ch of g.chains || []) {
        for (const ev of ch.events || []) {
          if (ev.from_user_id === p.id && ["REGULAR_HANDOFF", "HARDSHIP", "VOLUNTEER_EXEMPT", "SQUAD_NOMINATION", "VOLUNTEER_AUTO_FORWARD"].includes(ev.event_type)) {
            handoffEvents.push({ g, ch, ev });
          }
        }
      }
    }
    handoffEvents.sort((a, b) => new Date(b.ev.created_at).getTime() - new Date(a.ev.created_at).getTime());

    const isMe = p.id === state.user.id;
    const initials = ((p.first_name?.[0] || "") + (p.last_name?.[0] || "")).toUpperCase();

    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal" style="max-width:650px;max-height:90vh;overflow-y:auto;padding:24px">
          
          <div class="player-detail-hero">
            <div class="player-detail-header-flex">
              <div class="player-detail-avatar">${initials}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                  <h2 style="margin:0;font-size:1.3rem;color:#ffffff">${esc(p.last_name)}, ${esc(p.first_name)}</h2>
                  ${isMe ? `<span class="badge badge-gold" style="font-size:0.75rem">Du</span>` : ""}
                </div>
                <div style="font-size:0.85rem;color:rgba(255,255,255,0.85);margin-top:3px">
                  ${roleLabel(p.role)} &bull; ${esc(p.email)} ${p.mobile_number ? `&bull; 📞 ${esc(p.mobile_number)}` : ""}
                  ${p.iban ? `<br>🏦 IBAN: ${esc(p.iban)}` : ""}
                  ${p.paypal ? `${p.iban ? " &bull; " : "<br>"}🅿️ PayPal: ${esc(p.paypal)}` : ""}
                </div>
                <div style="font-size:0.75rem;color:rgba(255,255,255,0.7);margin-top:2px">
                  ${isAllTime ? "🏆 Daten über alle Saisons hinweg (Ewige Tabelle)" : `Saison: <strong>${esc(currentSeason?.name || "Aktuell")}</strong>`}
                </div>
              </div>
            </div>
          </div>

          <div class="player-detail-metrics">
            <div class="metric-card">
              <div class="metric-card-val" style="color:var(--text)">${p.deployedCount}</div>
              <div class="metric-card-lbl">Gepfiffen ${p.isDeployedOverridden ? `(korr.)` : ""}</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-val" style="color:var(--success)">${formatEuro(p.earnedPayoutCents || 0)}</div>
              <div class="metric-card-lbl">Topf-Prämie ${p.isEarnedOverridden ? `(korr.)` : ""}</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-val" style="color:var(--info)">${p.takeoverCount || 0}×</div>
              <div class="metric-card-lbl">Gerettet ${p.isTakeoverOverridden ? `(korr.)` : ""}</div>
            </div>
            <div class="metric-card">
              <div class="metric-card-val" style="color:var(--warn)">${p.handoffCount || 0}×</div>
              <div class="metric-card-lbl">Weitergegeben ${p.isHandoffOverridden ? `(korr.)` : ""}</div>
            </div>
          </div>

          ${
            (state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN")
              ? `
                <div style="background:var(--card-bg, #f8fafc);border:1px solid var(--border, #e2e8f0);border-radius:8px;padding:12px 14px;margin-bottom:16px">
                  <div style="display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="const f=document.getElementById('stats-override-form'); f.style.display = f.style.display==='none'?'block':'none'">
                    <span style="font-weight:600;font-size:0.88rem;display:flex;align-items:center;gap:6px">
                      ⚙️ <span>Statistik-Werte anpassen (Schiriwart/Admin)</span>
                    </span>
                    <button type="button" class="btn btn-outline" style="font-size:0.75rem;padding:3px 8px">Bearbeiten ▾</button>
                  </div>
                  <form id="stats-override-form" style="display:none;margin-top:12px;border-top:1px solid var(--border,#e2e8f0);padding-top:10px" onsubmit="event.preventDefault(); saveStatsOverrides(${p.id})">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                      <div class="form-group" style="margin-bottom:6px">
                        <label style="font-size:0.8rem">Gepfiffene Spiele:</label>
                        <input type="number" id="sov-deployed" min="0" value="${p.deployedCount ?? 0}" />
                      </div>
                      <div class="form-group" style="margin-bottom:6px">
                        <label style="font-size:0.8rem">Topf-Prämie (€):</label>
                        <input type="number" id="sov-earned" step="0.5" min="0" value="${((p.earnedPayoutCents ?? 0) / 100).toFixed(2)}" />
                      </div>
                      <div class="form-group" style="margin-bottom:6px">
                        <label style="font-size:0.8rem">Gerettet (Übernahmen):</label>
                        <input type="number" id="sov-takeover" min="0" value="${p.takeoverCount ?? 0}" />
                      </div>
                      <div class="form-group" style="margin-bottom:6px">
                        <label style="font-size:0.8rem">Weitergegeben:</label>
                        <input type="number" id="sov-handoff" min="0" value="${p.handoffCount ?? 0}" />
                      </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
                      <button type="submit" class="btn btn-primary" style="font-size:0.82rem;padding:5px 12px">Korrekturen speichern</button>
                      <span style="font-size:0.75rem;color:var(--muted)">Werte werden direkt in den Statistiken und Ranglisten übernommen.</span>
                    </div>
                  </form>
                </div>
              `
              : ""
          }

          ${
            p.isDeployedOverridden || p.isEarnedOverridden || p.isTakeoverOverridden || p.isHandoffOverridden
              ? `
                <div class="alert alert-info" style="font-size:0.83rem;margin-bottom:16px">
                  ℹ️ <strong>Manuelle Anpassung:</strong> Für diesen Spieler wurden Statistik-Werte durch die Schiedsrichter-Administration manuell angepasst oder vorgegeben.
                </div>
              `
              : ""
          }

          <!-- 1. Gepfiffene Spiele -->
          <div class="modal-section-title">
            <span>🏑 Gepfiffene Spiele &amp; Einsätze (${whistledChains.length})</span>
          </div>
          ${
            whistledChains.length === 0
              ? `<div style="font-size:0.82rem;color:var(--muted);padding:8px 0;margin-bottom:12px">In dieser Saison noch keine abgeschlossenen Spiele als Schiri geleistet.</div>`
              : `
                <div class="detail-item-list">
                  ${whistledChains
                    .map(({ g, ch }) => {
                      const potCents = ch.payout_pool_cents || 0;
                      return `
                        <div class="detail-item-card deployed">
                          <div>
                            <div style="font-weight:700;color:var(--text)">${esc(g.title)}</div>
                            <div class="detail-item-meta">
                              📅 ${formatDate(g.kickoff_at)} &bull; 📍 ${esc(g.location || "RHTC")} &bull; Slot: ${esc(ch.ref_code || `#${ch.slot_number}`)}
                            </div>
                          </div>
                          <div style="text-align:right">
                            <span class="badge ${ch.status === "CONFIRMED_DEPLOYED" ? "badge-green" : "badge-amber"}">
                              ${ch.status === "CONFIRMED_DEPLOYED" ? "Gepfiffen ✓" : "Gemeldet"}
                            </span>
                            ${potCents > 0 ? `<div style="font-size:0.75rem;color:var(--success);font-weight:700;margin-top:2px">+${formatEuro(potCents)} Prämie</div>` : ""}
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
          }

          <!-- 2. Übernommene Einsätze (Retter) -->
          <div class="modal-section-title" style="margin-top:20px">
            <span>🛡️ Als Retter eingesprungen (${takeoverEvents.length})</span>
          </div>
          ${
            takeoverEvents.length === 0
              ? `<div style="font-size:0.82rem;color:var(--muted);padding:8px 0;margin-bottom:12px">Noch keine Einsätze von anderen Spielern übernommen.</div>`
              : `
                <div class="detail-item-list">
                  ${takeoverEvents
                    .map(({ g, ch, ev }) => {
                      const fromName = ev.fromUser ? fullName(ev.fromUser) : "Teamkamerad";
                      return `
                        <div class="detail-item-card takeover">
                          <div>
                            <div style="font-weight:700;color:var(--text)">${esc(g.title)}</div>
                            <div class="detail-item-meta">
                              Eingesprungen für: <strong>${esc(fromName)}</strong> &bull; am ${formatDate(ev.created_at)}
                            </div>
                          </div>
                          <div style="text-align:right">
                            <span class="badge badge-blue">Gerettet</span>
                            ${ch.payout_pool_cents > 0 ? `<div style="font-size:0.75rem;color:var(--success);font-weight:700;margin-top:2px">${formatEuro(ch.payout_pool_cents)} Topf</div>` : ""}
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
          }

          <!-- 3. Weitergegebene Termine -->
          <div class="modal-section-title" style="margin-top:20px">
            <span>🏃 Weitergegebene Ansetzungen (${handoffEvents.length})</span>
          </div>
          ${
            handoffEvents.length === 0
              ? `<div style="font-size:0.82rem;color:var(--muted);padding:8px 0;margin-bottom:12px">Keine Weitergaben in diesem Zeitraum veranlasst.</div>`
              : `
                <div class="detail-item-list">
                  ${handoffEvents
                    .map(({ g, ev }) => {
                      const reason = chainReasonLabel(ev.reason_type, ev.is_short_notice, ev.event_type);
                      const targetName = ev.toUser ? fullName(ev.toUser) : "Weitergabekette";
                      return `
                        <div class="detail-item-card handoff">
                          <div>
                            <div style="font-weight:700;color:var(--text)">${esc(g.title)}</div>
                            <div class="detail-item-meta">
                              Grund: ${esc(reason)} &bull; Weitergereicht an: <strong>${esc(targetName)}</strong>
                            </div>
                            <div class="detail-item-meta">${formatDate(ev.created_at)}</div>
                          </div>
                          <div style="text-align:right">
                            ${chainPaymentBadge(ev)}
                            <div style="font-size:0.75rem;color:var(--muted);margin-top:2px">Gebühr: ${formatEuro(ev.fee_total_cents || 0)}</div>
                          </div>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
          }

          <div class="btn-row" style="margin-top:24px;border-top:1px solid var(--border);padding-top:14px">
            <button type="button" class="btn btn-primary" onclick="closeModal()" style="margin-left:auto">Schließen</button>
          </div>

        </div>
      </div>
    `;
  }

  if (state.modal.type === "settlePlayer") {
    const { player, readyChains, openEvents, totalPayoutCreditCents, totalOpenFeeCents, netBalanceCents } = state.modal;

    const isNetPlus = netBalanceCents > 0;
    const isNetZero = netBalanceCents === 0;
    const isNetMinus = netBalanceCents < 0;

    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal" style="max-width:580px;max-height:90vh;overflow-y:auto;padding:24px">
          <h3 style="margin-top:0;font-size:1.15rem;display:flex;align-items:center;gap:6px">
            <span>⚖️ Kassen-Abrechnung &amp; Verrechnung</span>
          </h3>
          <p style="font-size:0.86rem;color:var(--muted);margin-top:2px">
            Spieler: <strong>${esc(player.last_name)}, ${esc(player.first_name)}</strong> (${roleLabel(player.role)})
          </p>

          <!-- Saldo-Kachel -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;font-weight:600">Topf-Guthaben (bereit)</div>
              <div style="font-size:1.1rem;font-weight:700;color:var(--success)">+${formatEuro(totalPayoutCreditCents)}</div>
            </div>
            <div>
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;font-weight:600">Offene Gebühren</div>
              <div style="font-size:1.1rem;font-weight:700;color:var(--danger)">-${formatEuro(totalOpenFeeCents)}</div>
            </div>
            <div style="border-left:2px solid #cbd5e1;padding-left:14px">
              <div style="font-size:0.75rem;color:var(--muted);text-transform:uppercase;font-weight:600">Netto-Saldo</div>
              <div style="font-size:1.25rem;font-weight:800;color:${isNetPlus ? "var(--success)" : isNetMinus ? "var(--danger)" : "var(--muted)"}">
                ${isNetPlus ? `+${formatEuro(netBalanceCents)}` : formatEuro(netBalanceCents)}
              </div>
            </div>
          </div>

          <!-- Bankverbindung / Auszahlungskonto des Spielers -->
          <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:0.83rem">
            <strong>💳 Auszahlungskonto des Spielers:</strong>
            ${
              player.iban || player.paypal
                ? `<div style="margin-top:4px">
                    ${player.iban ? `<div>🏦 <strong>IBAN:</strong> <span style="user-select:all">${esc(player.iban)}</span></div>` : ""}
                    ${player.paypal ? `<div>🅿️ <strong>PayPal:</strong> <span style="user-select:all">${esc(player.paypal)}</span></div>` : ""}
                  </div>`
                : `<div style="color:var(--muted);margin-top:2px">Keine Bankverbindung (IBAN / PayPal) hinterlegt.</div>`
            }
          </div>

          <!-- 1. Bereitstehende Topf-Auszahlungen -->
          <div style="font-size:0.88rem;font-weight:700;margin:12px 0 6px;color:var(--text)">
            💰 Bereitstehende Topf-Guthaben (${readyChains.length})
          </div>
          ${
            readyChains.length === 0
              ? `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:10px">Kein ausstehendes Topf-Guthaben vorhanden.</div>`
              : `
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
                  ${readyChains
                    .map(({ g, ch }) => `
                      <div style="background:#ffffff;border:1px solid var(--border);border-left:3px solid var(--success);border-radius:6px;padding:6px 10px;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center">
                        <div>
                          <strong>${esc(g.title)}</strong> (Slot ${ch.slot_number}${ch.ref_code ? ` / ${esc(ch.ref_code)}` : ""})
                          <div style="color:var(--muted);font-size:0.75rem">${formatDate(g.kickoff_at)} &bull; Gepfiffen ✓</div>
                        </div>
                        <strong style="color:var(--success)">+${formatEuro(ch.payout_pool_cents)}</strong>
                      </div>
                    `)
                    .join("")}
                </div>
              `
          }

          <!-- 2. Offene Weitergabe-Gebühren -->
          <div style="font-size:0.88rem;font-weight:700;margin:14px 0 6px;color:var(--text)">
            ⚠️ Offene Weitergabe-Gebühren (${openEvents.length})
          </div>
          ${
            openEvents.length === 0
              ? `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:14px">Keine offenen Gebühren bei diesem Spieler.</div>`
              : `
                <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:14px">
                  ${openEvents
                    .map((ev) => {
                      const due = getRemainingOpenCents(ev);
                      const totalFee = Math.max(0, (ev.fee_total_cents || 0) - (ev.waived_amount_cents || 0));
                      return `
                        <div style="background:#ffffff;border:1px solid var(--border);border-left:3px solid var(--danger);border-radius:6px;padding:6px 10px;font-size:0.82rem;display:flex;justify-content:space-between;align-items:center">
                          <div>
                            Weitergabe am ${formatDate(ev.created_at)}
                            ${ev.credit_offset_cents > 0 ? `<div style="color:var(--muted);font-size:0.75rem">Gesamt: ${formatEuro(totalFee)} (${formatEuro(ev.credit_offset_cents)} bereits verrechnet)</div>` : ""}
                            ${ev.public_note ? `<div style="color:var(--muted);font-size:0.75rem">Hinweis: „${esc(ev.public_note)}“</div>` : ""}
                          </div>
                          <strong style="color:var(--danger)">-${formatEuro(due)}</strong>
                        </div>
                      `;
                    })
                    .join("")}
                </div>
              `
          }

          <!-- Auswahl der Aktion -->
          <div style="background:#fffdf4;border:1px solid var(--gold);border-radius:8px;padding:12px;margin:16px 0;font-size:0.84rem">
            <strong style="display:block;margin-bottom:6px;color:#92400e">Abrechnungs-Optionen für Kassenwart:</strong>
            ${
              totalPayoutCreditCents > 0 && totalOpenFeeCents > 0
                ? `
                  <div style="margin-bottom:6px">
                    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                      <input type="radio" name="settle-mode" id="settle-mode-offset" value="offset" checked style="margin-top:2px" />
                      <div>
                        <strong>Guthaben &amp; Gebühren direkt verrechnen (Empfohlen)</strong>
                        <div style="font-size:0.78rem;color:var(--muted)">
                          ${
                            isNetPlus
                              ? `Die ${formatEuro(totalOpenFeeCents)} Gebühren werden als bezahlt verbucht. Der verbleibende Restbetrag von <strong>${formatEuro(netBalanceCents)}</strong> wird als Netto-Guthaben an den Spieler ausgezahlt.`
                              : isNetZero
                              ? `Topf-Guthaben und Gebühren heben sich gegenseitig vollständig auf (0,00 € Auszahlung). Alle offenen Gebühren werden als bezahlt verbucht.`
                              : `Das gesamte Topf-Guthaben (${formatEuro(totalPayoutCreditCents)}) wird auf die Gebühren angerechnet. Der verbleibende Restbetrag von <strong>${formatEuro(Math.abs(netBalanceCents))}</strong> bleibt als offene Gebühr bestehen.`
                          }
                        </div>
                      </div>
                    </label>
                  </div>
                  <div>
                    <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                      <input type="radio" name="settle-mode" id="settle-mode-raw" value="raw" style="margin-top:2px" />
                      <div>
                        <strong>Reine Topf-Auszahlung (ohne Verrechnung)</strong>
                        <div style="font-size:0.78rem;color:var(--muted)">
                          Zahlt das gesamte Topf-Guthaben von <strong>${formatEuro(totalPayoutCreditCents)}</strong> vollständig aus. Die offenen Gebühren (${formatEuro(totalOpenFeeCents)}) bleiben unberührt.
                        </div>
                      </div>
                    </label>
                  </div>
                `
                : totalPayoutCreditCents > 0
                ? `
                  <input type="hidden" name="settle-mode" id="settle-mode-raw" value="raw" />
                  <div>Reine Auszahlung des Topf-Guthabens von <strong>${formatEuro(totalPayoutCreditCents)}</strong> an den Spieler. (Keine offenen Gebühren vorhanden)</div>
                `
                : `
                  <input type="hidden" name="settle-mode" id="settle-mode-offset" value="offset" />
                  <div>Der Spieler hat offene Gebühren (${formatEuro(totalOpenFeeCents)}), aber kein bereitstehendes Topf-Guthaben zur Verrechnung. Gebühren können über die Tabelle einzeln oder per Zahlungseingang beglichen werden.</div>
                `
            }
          </div>

          <div class="btn-row" style="margin-top:20px;border-top:1px solid var(--border);padding-top:12px">
            ${
              totalPayoutCreditCents > 0
                ? `<button type="button" class="btn btn-success" onclick="executeSettlePlayer(${player.id})">Abrechnung durchführen</button>`
                : ""
            }
            <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "treasurySettings") {
    const ts = state.data?.treasurySettings || {};
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal" style="max-width:500px">
          <h3 style="margin-top:0">⚙️ Bankverbindung der Mannschaftskasse</h3>
          <p style="font-size:0.85rem;color:var(--muted)">
            Diese Daten werden automatisch in die WhatsApp- und Text-Zahlungserinnerungen für säumige Spieler eingesetzt.
          </p>
          <form id="treasury-settings-form">
            <div class="form-group">
              <label>Kontoinhaber / Empfänger</label>
              <input type="text" id="ts-recipient" value="${esc(ts.recipient || "RHTC 2. Herren Kasse")}" required />
            </div>
            <div class="form-group">
              <label>IBAN</label>
              <input type="text" id="ts-iban" value="${esc(ts.iban || "")}" placeholder="z. B. DE12 3456 7890 1234 5678 90" />
            </div>
            <div class="form-group">
              <label>PayPal.me-Link (optional)</label>
              <input type="text" id="ts-paypal" value="${esc(ts.paypal || "")}" placeholder="z. B. paypal.me/rhtc2herren" />
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Einstellungen speichern</button>
              <button type="button" class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "reminder") {
    const { title, subtitle, message, recipientUser, isGroupShare } = state.modal;

    // Telefonnummer säubern für wa.me
    let phoneClean = (recipientUser?.mobile_number || "").replace(/[^0-9]/g, "");
    if (phoneClean.startsWith("0")) {
      phoneClean = "49" + phoneClean.slice(1);
    }
    const canDirectWhatsApp = !isGroupShare && phoneClean.length >= 8;
    const waUrl = canDirectWhatsApp
      ? `https://wa.me/${phoneClean}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;

    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal" style="max-width:580px">
          <h3 style="margin-top:0">${esc(title)}</h3>
          ${subtitle ? `<p style="font-size:0.85rem;color:var(--muted);margin:-4px 0 12px 0">${esc(subtitle)}</p>` : ""}
          
          <div class="form-group">
            <label style="font-weight:600;display:flex;justify-content:space-between;align-items:center">
              <span>Nachrichtenvorlage (anpassbar):</span>
              ${
                recipientUser
                  ? `<span style="font-size:0.75rem;color:var(--muted)">Empfänger: <strong>${esc(fullName(recipientUser))}</strong>${recipientUser.mobile_number ? ` (📞 ${esc(recipientUser.mobile_number)})` : " (keine Handynr.)"}</span>`
                  : `<span style="font-size:0.75rem;color:var(--muted)">Für: <strong>Mannschafts-Chat</strong></span>`
              }
            </label>
            <textarea id="reminder-msg-box" rows="6" style="width:100%;box-sizing:border-box;font-family:inherit;font-size:0.88rem;padding:10px;border-radius:6px;border:1px solid var(--border);line-height:1.4">${esc(message)}</textarea>
          </div>

          <div class="btn-row" style="margin-top:16px">
            <button type="button" class="btn btn-primary" onclick="copyReminderText()">📋 Text kopieren</button>
            <button type="button" class="btn btn-success" onclick="openWhatsAppWithReminder('${canDirectWhatsApp ? phoneClean : ""}')">
              ${canDirectWhatsApp ? `💬 WhatsApp an ${esc(recipientUser.first_name)}` : `💬 In WhatsApp teilen`}
            </button>
            <button type="button" class="btn btn-outline" onclick="closeModal()">Schließen</button>
          </div>
        </div>
      </div>
    `;
  }

  if (state.modal.type === "hardship") {
    const ev = state.modal.ev;
    return `
      <div class="modal-backdrop" onclick="if(event.target===this) closeModal()">
        <div class="modal">
          <h3 style="margin-top:0">Härtefallprüfung (§ 8 – vertraulich)</h3>
          <p><strong>Antragsteller:</strong> ${esc(fullName(ev.fromUser))}</p>
          <div class="alert alert-info"><strong>Vertrauliche Begründung:</strong><br>${esc(ev.hardship_reason_confidential || "–")}</div>
          <div class="form-group">
            <label>Teilverzicht-Betrag in Cent (nur bei Teilverzicht, z. B. 1000 = 10,00 € Erlass)</label>
            <input type="number" id="hs-waive" value="1000" min="100" max="1500" step="100" />
          </div>
          <div class="btn-row">
            <button class="btn btn-success" onclick="submitHardship(${ev.id}, 'APPROVED_FULL')">Vollständiger Verzicht (15 €)</button>
            <button class="btn btn-warn" onclick="submitHardship(${ev.id}, 'APPROVED_PARTIAL')">Teilverzicht</button>
            <button class="btn btn-danger" onclick="submitHardship(${ev.id}, 'REJECTED')">Ablehnen</button>
            <button class="btn btn-outline" onclick="closeModal()">Abbrechen</button>
          </div>
        </div>
      </div>
    `;
  }

  return "";
}

function render() {
  const root = document.getElementById("app");
  if (!state.user || !state.data) {
    root.innerHTML = renderLogin();
    const form = document.getElementById("login-form");
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        state.error = null;
        try {
          await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({
              email: document.getElementById("login-email").value,
              password: document.getElementById("login-password").value,
            }),
          });
          await loadDashboard();
        } catch (err) {
          state.error = err.message;
          render();
        }
      };
    }
    return;
  }

  const myOpenPaymentsCount = (state.data.events || []).filter(
    (e) => e.from_user_id === state.user.id && e.payment_status === "OPEN" && getRemainingOpenCents(e) > 0
  ).length;

  const pendingCount =
    state.data.games.reduce(
      (acc, g) =>
        acc +
        g.chains.filter((c) => {
          const rid = c.pending_assignee_id ?? c.current_assignee_id;
          return (
            rid === state.user.id &&
            (c.status === "ASSIGNED" ||
              c.status === "PENDING_HANDOFF" ||
              c.status === "VOLUNTARY_REQUESTED")
          );
        }).length,
      0
    ) + myOpenPaymentsCount;

  const showAdminTabs = canViewAdminTabs(state.user);
  const isWartOrAdmin =
    state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN";
  const currentSeason =
    state.data?.season ||
    (state.data?.seasons ? state.data.seasons.find((s) => s.id === state.selectedSeasonId) : null) ||
    state.data?.seasons?.[0];
  const seasonsList = state.data?.seasons || (currentSeason ? [currentSeason] : []);
  const seasonOpts =
    seasonsList
      .map(
        (s) =>
          `<option value="${s.id}" ${s.id === currentSeason?.id ? "selected" : ""}>${esc(s.name)}${s.is_active ? " (Aktiv)" : ""}</option>`
      )
      .join("") +
    `<option value="all" ${currentSeason?.id === "all" ? "selected" : ""}>🏆 Ewige Tabelle (Alle Saisons)</option>`;
  if (!showAdminTabs && !["games", "calendar", "tasks", "chains", "stats", "satzung"].includes(state.tab)) {
    state.tab = "games";
  }

  let tabContent = "";
  if (state.tab === "games") tabContent = renderGamesTab();
  else if (state.tab === "calendar") tabContent = renderCalendarTab();
  else if (state.tab === "tasks") tabContent = renderTasksTab();
  else if (state.tab === "chains") tabContent = renderChainsTab();
  else if (state.tab === "stats") tabContent = renderStatsTab();
  else if (state.tab === "satzung") tabContent = renderSatzungTab();
  else if (state.tab === "players" && showAdminTabs) tabContent = renderPlayersTab();
  else if (state.tab === "treasury" && showAdminTabs) tabContent = renderTreasuryTab();
  else if (state.tab === "docs" && showAdminTabs) tabContent = renderDocsTab();

  const tabLabels = {
    games: "Schiri-Ansetzungen",
    calendar: "Kalender",
    tasks: "Meine Aufgaben",
    chains: "Weitergabeketten",
    stats: "Statistiken & Rangliste",
    satzung: "Schiedsrichtersatzung",
    players: "Mannschaftsliste",
    treasury: "Kasse & Härtefälle",
    docs: "Dokumentation (§ 6)",
  };

  const currentViewTitle = tabLabels[state.tab] || "Schiri-Ansetzungen";

  root.innerHTML = `
    ${renderInstallBannerHtml()}
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:14px;overflow:hidden">
        <button class="hamburger-btn" onclick="openDrawer()" aria-label="Menü öffnen" title="Menü öffnen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
          <span class="hamburger-label">Menü</span>
        </button>
        <div class="brand">
          <div class="brand-crest">${RHTC_CREST_SVG}</div>
          <h1>${currentViewTitle}</h1>
        </div>
      </div>

      <div class="topbar-right">
        <div class="topbar-season-wrap" title="Saison auswählen">
          <span class="topbar-season-label">Saison:</span>
          <select class="topbar-season-select" onchange="changeSeason(this.value)" aria-label="Saison auswählen">
            ${seasonOpts}
          </select>
        </div>

        <div class="header-current-view" onclick="openDrawer()" title="Bereich wechseln">
          <span class="view-tag">Bereich:</span>
          <strong>${currentViewTitle}</strong>
          <span class="view-caret">▾</span>
        </div>

        ${
          pendingCount > 0
            ? `
              <button class="btn btn-danger btn-sm header-tasks-alert" onclick="setTab('tasks')">
                <span>📋 Meine Aufgaben</span> <span class="badge badge-red" style="background:#fff;color:var(--danger);font-weight:800">${pendingCount}</span>
              </button>
            `
            : ""
        }

        <button class="header-user-btn" onclick="openDrawer()" title="Menü &amp; Profil öffnen">
          <span class="avatar-circle-sm">${((state.user.first_name?.[0] || "") + (state.user.last_name?.[0] || "")).toUpperCase()}</span>
          <span class="header-user-name">${esc(fullName(state.user))}</span>
          <span class="badge badge-gray" style="font-size:0.72rem">${roleLabel(state.user.role)}</span>
        </button>
      </div>
    </header>

    <div class="mobile-subbar">
      <button class="mobile-subbar-btn" onclick="openDrawer()">
        <span style="font-size:1.1rem;color:var(--gold)">☰</span>
        <span>Bereich: <strong>${tabLabels[state.tab] || state.tab}</strong></span>
        <span style="margin-left:auto;color:var(--muted);font-size:0.75rem">Tippen zum Wechseln ▾</span>
      </button>
    </div>

    <!-- Slide-Over Drawer & Backdrop -->
    <div class="drawer-backdrop" id="drawer-backdrop" onclick="closeDrawer()"></div>
    <aside class="drawer" id="mobile-drawer">
      <div class="drawer-header">
        <div class="brand">
          <div class="brand-crest" style="width:36px;height:36px">${RHTC_CREST_SVG}</div>
          <h2 style="margin:0;font-size:1.05rem;font-weight:800;color:#fff">Schiri-Ansetzungen</h2>
        </div>
        <button class="drawer-close-btn" onclick="closeDrawer()" title="Menü schließen">&times;</button>
      </div>

      <div class="drawer-user-card">
        <div style="display:flex;align-items:center;gap:10px">
          <div class="drawer-user-avatar">${((state.user.first_name?.[0] || "") + (state.user.last_name?.[0] || "")).toUpperCase()}</div>
          <div style="overflow:hidden">
            <div style="font-weight:700;font-size:0.92rem;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${esc(fullName(state.user))}
            </div>
            <div style="font-size:0.75rem;color:var(--gold)">
              ${roleLabel(state.user.role)}
            </div>
          </div>
        </div>
        <div class="drawer-user-actions">
          <button class="btn btn-outline btn-sm" onclick="openProfileModal(); closeDrawer()">👤 Mein Profil</button>
          <button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,0.4)" onclick="logout(); closeDrawer()">🚪 Abmelden</button>
        </div>
      </div>

      <div class="drawer-section">
        <div class="drawer-section-title">Saison</div>
        <div class="drawer-season-wrap">
          <select onchange="changeSeason(this.value); closeDrawer()" class="drawer-season-select">
            ${seasonOpts}
          </select>
          ${
            isWartOrAdmin
              ? `
                <div class="drawer-season-actions">
                  <button class="btn btn-outline btn-sm" onclick="openAddSeasonModal(); closeDrawer()">+ Saison</button>
                  ${currentSeason ? `<button class="btn btn-outline btn-sm" onclick="openEditSeasonModal(); closeDrawer()">Umbenennen</button>` : ""}
                  ${currentSeason && !currentSeason.is_active ? `<button class="btn btn-warn btn-sm" onclick="activateSeason(${currentSeason.id}); closeDrawer()">Aktivieren</button>` : ""}
                  ${currentSeason && seasonsList.length > 1 ? `<button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,0.4)" onclick="deleteSeason(${currentSeason.id}, '${esc(currentSeason.name)}'); closeDrawer()">Löschen</button>` : ""}
                </div>
              `
              : ""
          }
        </div>
      </div>

      <div class="drawer-section" style="flex:1">
        <div class="drawer-section-title">Navigation</div>
        <nav class="drawer-nav">
          <button class="drawer-nav-item ${state.tab === "games" ? "active" : ""}" onclick="setTab('games')">
            <span class="drawer-nav-icon">🏑</span>
            <span class="drawer-nav-text">Schiri-Ansetzungen</span>
          </button>
          <button class="drawer-nav-item ${state.tab === "calendar" ? "active" : ""}" onclick="setTab('calendar')">
            <span class="drawer-nav-icon">📅</span>
            <span class="drawer-nav-text">Kalender</span>
          </button>
          <button class="drawer-nav-item ${state.tab === "tasks" ? "active" : ""}" onclick="setTab('tasks')">
            <span class="drawer-nav-icon">📋</span>
            <span class="drawer-nav-text">Meine Aufgaben</span>
            ${pendingCount > 0 ? `<span class="badge badge-red" style="margin-left:auto">${pendingCount}</span>` : ""}
          </button>
          <button class="drawer-nav-item ${state.tab === "chains" ? "active" : ""}" onclick="setTab('chains')">
            <span class="drawer-nav-icon">🔄</span>
            <span class="drawer-nav-text">Weitergabeketten</span>
          </button>
          <button class="drawer-nav-item ${state.tab === "stats" ? "active" : ""}" onclick="setTab('stats')">
            <span class="drawer-nav-icon">🏆</span>
            <span class="drawer-nav-text">Statistiken &amp; Rangliste</span>
          </button>
          <button class="drawer-nav-item ${state.tab === "satzung" ? "active" : ""}" onclick="setTab('satzung')">
            <span class="drawer-nav-icon">📜</span>
            <span class="drawer-nav-text">Schiedsrichtersatzung</span>
          </button>

          ${
            showAdminTabs
              ? `
                <div class="drawer-section-title" style="margin-top:16px">Verwaltung &amp; Regeln (§§ 1–8)</div>
                <button class="drawer-nav-item ${state.tab === "players" ? "active" : ""}" onclick="setTab('players')">
                  <span class="drawer-nav-icon">👥</span>
                  <span class="drawer-nav-text">Schiedsrichterliste (§ 2)</span>
                </button>
                <button class="drawer-nav-item ${state.tab === "treasury" ? "active" : ""}" onclick="setTab('treasury')">
                  <span class="drawer-nav-icon">💰</span>
                  <span class="drawer-nav-text">Kasse &amp; Härtefälle</span>
                </button>
                <button class="drawer-nav-item ${state.tab === "docs" ? "active" : ""}" onclick="setTab('docs')">
                  <span class="drawer-nav-icon">📄</span>
                  <span class="drawer-nav-text">Dokumentation (§ 6)</span>
                </button>
              `
              : ""
          }
        </nav>
      </div>
    </aside>

    <div class="container">
      ${state.error ? `<div class="alert alert-danger">${esc(state.error)}</div>` : ""}
      ${tabContent}
    </div>

    <!-- Mobile Bottom Navigation Bar -->
    <nav class="mobile-bottom-nav">
      <button class="bottom-nav-item ${state.tab === "games" ? "active" : ""}" onclick="setTab('games')">
        <span class="bottom-nav-icon">🏑</span>
        <span class="bottom-nav-label">Spiele</span>
      </button>
      <button class="bottom-nav-item ${state.tab === "calendar" ? "active" : ""}" onclick="setTab('calendar')">
        <span class="bottom-nav-icon">📅</span>
        <span class="bottom-nav-label">Kalender</span>
      </button>
      <button class="bottom-nav-item ${state.tab === "tasks" ? "active" : ""}" onclick="setTab('tasks')">
        <span class="bottom-nav-icon">
          📋
          ${pendingCount > 0 ? `<span class="bottom-nav-badge">${pendingCount}</span>` : ""}
        </span>
        <span class="bottom-nav-label">Aufgaben</span>
      </button>
      <button class="bottom-nav-item ${state.tab === "stats" ? "active" : ""}" onclick="setTab('stats')">
        <span class="bottom-nav-icon">🏆</span>
        <span class="bottom-nav-label">Statistik</span>
      </button>
      <button class="bottom-nav-item ${["players", "treasury", "chains", "docs", "satzung"].includes(state.tab) ? "active" : ""}" onclick="openDrawer()">
        <span class="bottom-nav-icon">⋯</span>
        <span class="bottom-nav-label">Mehr</span>
      </button>
    </nav>

    ${renderModal()}
  `;

  attachModalHandlers();
}

function attachModalHandlers() {
  const hfForm = document.getElementById("handoff-form");
  if (hfForm) {
    hfForm.onsubmit = async (e) => {
      e.preventDefault();
      const chainId = state.modal?.chain?.id;
      if (!chainId) return;
      try {
        const targetEl = document.getElementById("hf-target");
        const targetUserId = targetEl && targetEl.value ? Number(targetEl.value) : undefined;
        const res = await api(`/api/chains/${chainId}/handoff`, {
          method: "POST",
          body: JSON.stringify({
            reasonType: document.getElementById("hf-reason").value,
            publicNote: document.getElementById("hf-note").value,
            hardshipReasonConfidential:
              document.getElementById("hf-hardship")?.value || "",
            targetUserId,
          }),
        });
        state.modal = null;
        await loadDashboard();
        if (res.chatMessage) showChatModal("Weitergabe eingeleitet", res.chatMessage);
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const esForm = document.getElementById("edit-season-form");
  if (esForm) {
    esForm.onsubmit = async (e) => {
      e.preventDefault();
      const seasonId =
        state.modal?.season?.id ||
        state.data?.season?.id ||
        state.selectedSeasonId;
      if (!seasonId) {
        alert("Keine Saison zum Bearbeiten ausgewählt.");
        return;
      }
      const newName = (document.getElementById("es-name")?.value || "").trim();
      if (!newName) {
        alert("Bitte einen Saisonnamen eingeben.");
        return;
      }
      try {
        await api(`/api/seasons/${seasonId}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: newName,
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const snForm = document.getElementById("add-season-form");
  if (snForm) {
    snForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const nameVal = (document.getElementById("sn-name")?.value || "").trim();
        if (!nameVal) {
          alert("Bitte einen Namen für die neue Saison eingeben.");
          return;
        }
        const setActive = !!document.getElementById("sn-active")?.checked;
        const res = await api("/api/seasons", {
          method: "POST",
          body: JSON.stringify({
            name: nameVal,
            setActive,
          }),
        });
        const newId = res.season?.id || res.id;
        if (newId) {
          state.selectedSeasonId = newId;
        }
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const gmForm = document.getElementById("add-game-form");
  if (gmForm) {
    gmForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const assignPlayers = document.getElementById("gm-assign") ? document.getElementById("gm-assign").checked : true;
        const isFirst = document.getElementById("gm-first") ? document.getElementById("gm-first").checked : false;
        const randomDraw = document.getElementById("gm-random") ? document.getElementById("gm-random").checked : false;
        const r1El = document.getElementById("gm-r1");
        const r2El = document.getElementById("gm-r2");

        await api("/api/games", {
          method: "POST",
          body: JSON.stringify({
            seasonId: state.data.season?.id,
            title: document.getElementById("gm-title").value,
            location: document.getElementById("gm-loc").value,
            kickoffAt: new Date(document.getElementById("gm-kickoff").value).toISOString(),
            assignPlayers,
            isFirstGameOfSeason: isFirst,
            randomDraw: randomDraw,
            ref1Id: (r1El && r1El.value) ? Number(r1El.value) : null,
            ref2Id: (r2El && r2El.value) ? Number(r2El.value) : null,
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const egForm = document.getElementById("edit-game-form");
  if (egForm) {
    egForm.onsubmit = async (e) => {
      e.preventDefault();
      const gameId = state.modal?.game?.id;
      if (!gameId) return;
      try {
        await api(`/api/games/${gameId}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: document.getElementById("eg-title").value,
            location: document.getElementById("eg-loc").value,
            kickoffAt: new Date(
              document.getElementById("eg-kickoff").value
            ).toISOString(),
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const maForm = document.getElementById("manual-assign-form");
  if (maForm) {
    maForm.onsubmit = async (e) => {
      e.preventDefault();
      const chainId = state.modal?.chain?.id;
      if (!chainId) return;
      try {
        await api(`/api/chains/${chainId}/manual-assign`, {
          method: "POST",
          body: JSON.stringify({
            userId: Number(document.getElementById("ma-user").value),
            status: document.getElementById("ma-status").value,
            note: document.getElementById("ma-note").value,
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const profForm = document.getElementById("profile-form");
  if (profForm) {
    profForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const passVal = document.getElementById("prof-pass").value.trim();
        await api("/api/auth/profile", {
          method: "PATCH",
          body: JSON.stringify({
            email: document.getElementById("prof-email").value,
            mobileNumber: document.getElementById("prof-mobile").value,
            iban: (document.getElementById("prof-iban")?.value || "").trim(),
            paypal: (document.getElementById("prof-paypal")?.value || "").trim(),
            ...(passVal ? { password: passVal } : {}),
          }),
        });
        state.modal = null;
        await loadDashboard();
        alert("Stammdaten erfolgreich gespeichert.");
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const epForm = document.getElementById("edit-player-form");
  if (epForm) {
    epForm.onsubmit = async (e) => {
      e.preventDefault();
      const playerId = state.modal?.player?.id;
      if (!playerId) return;
      try {
        const orderVal = document.getElementById("ep-order").value.trim();
        const passVal = document.getElementById("ep-pass").value.trim();

        await api(`/api/users/${playerId}`, {
          method: "PATCH",
          body: JSON.stringify({
            firstName: document.getElementById("ep-first").value,
            lastName: document.getElementById("ep-last").value,
            email: document.getElementById("ep-email").value,
            mobileNumber: document.getElementById("ep-mobile").value,
            iban: (document.getElementById("ep-iban")?.value || "").trim(),
            paypal: (document.getElementById("ep-paypal")?.value || "").trim(),
            role: document.getElementById("ep-role").value,
            listOrderOverride: orderVal === "" ? null : Number(orderVal),
            isActiveInList: document.getElementById("ep-active").checked,
            isVolunteerExempt: document.getElementById("ep-exempt").checked,
            ...(passVal ? { password: passVal } : {}),
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const plForm = document.getElementById("add-player-form");
  if (plForm) {
    plForm.onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            firstName: document.getElementById("pl-first").value,
            lastName: document.getElementById("pl-last").value,
            email: document.getElementById("pl-email").value,
            mobileNumber: document.getElementById("pl-mobile").value,
            iban: (document.getElementById("pl-iban")?.value || "").trim(),
            paypal: (document.getElementById("pl-paypal")?.value || "").trim(),
            password: document.getElementById("pl-pass").value,
            role: document.getElementById("pl-role").value,
            isVolunteerExempt: document.getElementById("pl-exempt").checked,
          }),
        });
        state.modal = null;
        await loadDashboard();
      } catch (err) {
        alert(err.message);
      }
    };
  }

  const tsForm = document.getElementById("treasury-settings-form");
  if (tsForm) {
    tsForm.onsubmit = async (e) => {
      e.preventDefault();
      const recipient = (document.getElementById("ts-recipient")?.value || "").trim();
      const iban = (document.getElementById("ts-iban")?.value || "").trim();
      const paypal = (document.getElementById("ts-paypal")?.value || "").trim();
      try {
        await api("/api/treasury/settings", {
          method: "POST",
          body: JSON.stringify({ recipient, iban, paypal }),
        });
        state.modal = null;
        await loadDashboard();
        alert("Bankverbindung erfolgreich gespeichert!");
      } catch (err) {
        alert(err.message);
      }
    };
  }
}

window.openDrawer = () => {
  const d = document.getElementById("mobile-drawer");
  const b = document.getElementById("drawer-backdrop");
  if (d) d.classList.add("open");
  if (b) b.classList.add("open");
  document.body.classList.add("drawer-open");
};

window.closeDrawer = () => {
  const d = document.getElementById("mobile-drawer");
  const b = document.getElementById("drawer-backdrop");
  if (d) d.classList.remove("open");
  if (b) b.classList.remove("open");
  document.body.classList.remove("drawer-open");
};

if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      window.closeDrawer();
    }
  });
}

window.setTab = (t) => {
  if (typeof window.closeDrawer === "function") window.closeDrawer();
  state.tab = t;
  state.error = null;
  if (t === "satzung") {
    loadSatzung(true);
  }
  render();
};

window.setSatzungSearch = (val, cursorPos) => {
  state.satzungSearch = val;
  render();
  const el = document.getElementById("satzung-search-input");
  if (el) {
    el.focus();
    if (typeof cursorPos === "number") {
      try {
        el.setSelectionRange(cursorPos, cursorPos);
      } catch {}
    }
  }
};

window.scrollToBylawSection = (sectionId) => {
  const el = document.getElementById(sectionId);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

window.loadSatzung = loadSatzung;

window.setGameFilter = (f) => {
  state.gameFilter = f;
  render();
};

function downloadCsv(filename, headers, rows) {
  const escCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    headers.map(escCell).join(";"),
    ...rows.map((r) => r.map(escCell).join(";")),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.changeSeason = async (seasonId) => {
  state.selectedSeasonId = seasonId === "all" ? "all" : Number(seasonId);
  await loadDashboard();
};

window.activateSeason = async (seasonId) => {
  try {
    await api(`/api/seasons/${seasonId}/activate`, { method: "POST" });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.deleteSeason = async (seasonId, seasonName) => {
  if (
    !confirm(
      `Saison "${seasonName}" inklusive aller zugehörigen Spiele und Ansetzungen wirklich unwiderruflich löschen?`
    )
  ) {
    return;
  }
  try {
    await api(`/api/seasons/${seasonId}`, { method: "DELETE" });
    state.selectedSeasonId = null;
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.exportPlayersCsv = () => {
  const sName = (state.data.season?.name || "Saison").replace(/\s+/g, "_");
  const headers = [
    "Nachname",
    "Vorname",
    "Email",
    "Mobilnummer",
    "IBAN",
    "PayPal",
    "Rolle",
    "Aktiv",
    "Ehrenamt_Par7",
    "Angesetzt",
    "Eingesetzt",
    "Offene_Gebuehren_EUR",
    "Bezahlt_EUR",
    "Auszahlung_EUR",
  ];
  const rows = state.data.players.map((p) => [
    p.last_name,
    p.first_name,
    p.email,
    p.mobile_number || "",
    p.iban || "",
    p.paypal || "",
    roleLabel(p.role),
    p.is_active_in_list ? "Ja" : "Nein",
    p.is_volunteer_exempt ? "Ja" : "Nein",
    p.activeAssigned,
    p.deployedCount,
    (p.openPaymentCents / 100).toFixed(2).replace(".", ","),
    (p.paidCents / 100).toFixed(2).replace(".", ","),
    (p.earnedPayoutCents / 100).toFixed(2).replace(".", ","),
  ]);
  downloadCsv(`RHTC_Einsatzliste_${sName}.csv`, headers, rows);
};

window.exportTreasuryCsv = () => {
  const sName = (state.data.season?.name || "Saison").replace(/\s+/g, "_");
  const isTreasurer = state.user.role === "KASSENWART";
  const gameMap = new Map(state.data.games.map((g) => [g.id, g]));
  const paymentEvents = state.data.events.filter(
    (e) => e.fee_total_cents > 0 || e.hardship_status !== "NONE"
  );
  const headers = [
    "ID",
    "Datum",
    "Spiel",
    "Spieler",
    "Vorgang",
    "Brutto_EUR",
    "Erlass_EUR",
    "Faellig_EUR",
    "Zahlungsstatus",
    "Haertefall_Status",
    ...(isTreasurer ? ["Vertrauliche_Begruendung"] : []),
  ];
  const rows = paymentEvents.map((ev) => {
    const g = gameMap.get(ev.game_id);
    const ch = g?.chains?.find((c) => c.id === ev.chain_id);
    const refCode = ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : `SR-${ev.chain_id}`);
    const due = ev.fee_total_cents - ev.waived_amount_cents;
    return [
      refCode,
      formatDate(ev.created_at),
      g ? g.title : ev.game_id,
      fullName(ev.fromUser),
      ev.event_type,
      (ev.fee_total_cents / 100).toFixed(2).replace(".", ","),
      (ev.waived_amount_cents / 100).toFixed(2).replace(".", ","),
      (due / 100).toFixed(2).replace(".", ","),
      ev.payment_status,
      ev.hardship_status,
      ...(isTreasurer ? [ev.hardship_reason_confidential || ""] : []),
    ];
  });
  downloadCsv(`RHTC_Kasse_${sName}.csv`, headers, rows);
};

function parseGermanDateTimeToIso(dateStr, timeStr) {
  const d = String(dateStr || "").trim();
  const tm = String(timeStr || "").match(/(\d{1,2}):(\d{2})/);
  const t = tm
    ? `${tm[1].padStart(2, "0")}:${tm[2]}`
    : "12:00";
  const deMatch = d.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (deMatch) {
    const day = deMatch[1].padStart(2, "0");
    const month = deMatch[2].padStart(2, "0");
    const year = deMatch[3];
    const dt = new Date(`${year}-${month}-${day}T${t}`);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const isoCandidate = d.includes("T") ? d : `${d}T${t}`;
  const dt = new Date(isoCandidate);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

window.handleGamesCsvFile = (input) => {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "").replace(/^\uFEFF/, "");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    const sep = lines[0].includes(";") ? ";" : ",";
    const parsedRows = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (i === 0 && cols[0].toLowerCase().includes("titel")) {
        continue;
      }
      if (cols.length < 2) continue;
      let kickoffAt = null;
      let location = "RHTC Halle";
      if (cols.length >= 3 && /^\d{1,2}:\d{2}/.test(cols[2])) {
        kickoffAt = parseGermanDateTimeToIso(cols[1], cols[2]);
        location = cols[3] || "RHTC Halle";
      } else {
        kickoffAt = parseGermanDateTimeToIso(cols[1], "12:00");
        location = cols[2] || "RHTC Halle";
      }
      if (!cols[0] || !kickoffAt) continue;
      parsedRows.push({ title: cols[0], kickoffAt, location });
    }
    state.modal.fileName = file.name;
    state.modal.parsedRows = parsedRows;
    state.modal.result = null;
    render();
  };
  reader.readAsText(file, "UTF-8");
};

window.submitGamesCsvImport = async () => {
  try {
    const assignEl = document.getElementById("ig-assign");
    const randomEl = document.getElementById("ig-random");
    const seasonId =
      state.data?.season?.id ||
      state.selectedSeasonId ||
      state.data?.seasons?.[0]?.id;
    const res = await api("/api/games/import", {
      method: "POST",
      body: JSON.stringify({
        seasonId,
        assignPlayers: assignEl ? assignEl.checked : true,
        randomFirstGame: randomEl ? randomEl.checked : false,
        rows: state.modal.parsedRows,
      }),
    });
    state.modal.result = res;
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.deleteGame = async (gameId, title) => {
  if (!confirm(`Spiel "${title}" inkl. aller Ansetzungen und Protokolle wirklich löschen?`)) return;
  try {
    await api(`/api/games/${gameId}`, { method: "DELETE" });
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.toggleSelectPlayer = (id, checked) => {
  if (checked) {
    if (!state.selectedPlayerIds.includes(id)) {
      state.selectedPlayerIds.push(id);
    }
  } else {
    state.selectedPlayerIds = state.selectedPlayerIds.filter((x) => x !== id);
  }
  render();
};

window.toggleSelectAllPlayers = (checked) => {
  if (checked) {
    state.selectedPlayerIds = state.data.players
      .filter((p) => p.id !== state.user.id)
      .map((p) => p.id);
  } else {
    state.selectedPlayerIds = [];
  }
  render();
};

window.deleteSinglePlayer = async (id, name) => {
  if (!confirm(`Spieler "${name}" wirklich löschen?`)) return;
  try {
    await api("/api/users/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids: [id] }),
    });
    state.selectedPlayerIds = state.selectedPlayerIds.filter((x) => x !== id);
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.bulkDeleteSelected = async () => {
  const ids = state.selectedPlayerIds.filter((id) => id !== state.user.id);
  if (ids.length === 0) return;
  if (!confirm(`${ids.length} ausgewählte Spieler wirklich löschen?`)) return;
  try {
    await api("/api/users/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    state.selectedPlayerIds = [];
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.handleCsvFile = (input) => {
  const file = input.files && input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || "").replace(/^\uFEFF/, "");
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    const sep = lines[0].includes(";") ? ";" : ",";
    const parsedRows = [];
    for (let i = 0; i < lines.length; i++) {
      const cols = lines[i].split(sep).map((c) => c.trim().replace(/^"|"$/g, ""));
      if (i === 0 && (cols[0].toLowerCase().includes("vorname") || cols[2]?.toLowerCase().includes("mail"))) {
        continue;
      }
      if (cols.length < 3) continue;
      // Unterstützt: Vorname;Nachname;Email;Mobilnummer;Rolle;Ehrenamt;Passwort
      const knownRoles = ["PLAYER", "SCHIEDSRICHTERWART", "KASSENWART", "VORSTAND", "ADMIN"];
      const col3Upper = (cols[3] || "").toUpperCase();
      const hasMobileCol = cols[3] !== undefined && !knownRoles.includes(col3Upper);
      const mobileNumber = hasMobileCol ? cols[3] : "";
      const roleCol = hasMobileCol ? cols[4] : cols[3];
      const exemptCol = hasMobileCol ? cols[5] : cols[4];
      const passCol = hasMobileCol ? cols[6] : cols[5];
      const exemptRaw = (exemptCol || "").toLowerCase();
      parsedRows.push({
        firstName: cols[0],
        lastName: cols[1],
        email: cols[2],
        mobileNumber,
        role: roleCol || "PLAYER",
        isVolunteerExempt: ["1", "true", "ja", "yes", "x"].includes(exemptRaw),
        password: passCol || "rhtc2026",
      });
    }
    state.modal.fileName = file.name;
    state.modal.parsedRows = parsedRows;
    state.modal.result = null;
    render();
  };
  reader.readAsText(file, "UTF-8");
};

window.submitCsvImport = async () => {
  try {
    const res = await api("/api/users/import", {
      method: "POST",
      body: JSON.stringify({ rows: state.modal.parsedRows }),
    });
    state.modal.result = res;
    await loadDashboard();
  } catch (err) {
    alert(err.message);
  }
};

window.togglePastDeployed = () => {
  state.showPastDeployed = !state.showPastDeployed;
  render();
};

window.shiftCalendarMonth = (delta) => {
  const d = new Date(state.calendarYear, state.calendarMonth + delta, 1);
  state.calendarYear = d.getFullYear();
  state.calendarMonth = d.getMonth();
  render();
};

window.resetCalendarToday = () => {
  const now = new Date();
  state.calendarYear = now.getFullYear();
  state.calendarMonth = now.getMonth();
  render();
};

window.quickLogin = async (email) => {
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "rhtc2026" }),
    });
    await loadDashboard();
  } catch (err) {
    state.error = err.message;
    render();
  }
};

window.logout = async () => {
  await api("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.data = null;
  render();
};

window.handoffById = (chainId) => {
  for (const g of state.data.games) {
    const ch = g.chains.find((c) => c.id === chainId);
    if (ch) return openHandoffModal(ch, g);
  }
};

window.toggleHardshipField = () => {
  const val = document.getElementById("hf-reason").value;
  document.getElementById("hf-hardship-wrap").style.display =
    val === "HARDSHIP" ? "block" : "none";
};

window.respondHandoff = async (chainId, action) => {
  try {
    const res = await api(`/api/chains/${chainId}/handoff-response`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    await loadDashboard();
    if (res.chatMessage) showChatModal("Gruppenchat-Mitteilung", res.chatMessage);
  } catch (err) {
    alert(err.message);
  }
};

window.requestVolunteer = async (chainId) => {
  try {
    const res = await api(`/api/chains/${chainId}/volunteer`, { method: "POST" });
    await loadDashboard();
    if (res.chatMessage) showChatModal("Freiwillige Übernahme angefragt", res.chatMessage);
  } catch (err) {
    alert(err.message);
  }
};

window.decideVolunteer = async (chainId, action) => {
  try {
    const res = await api(`/api/chains/${chainId}/volunteer-decision`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    await loadDashboard();
    if (res.chatMessage) showChatModal("Freiwillige Übernahme", res.chatMessage);
  } catch (err) {
    alert(err.message);
  }
};

window.reportDeployed = async (chainId) => {
  try {
    const res = await api(`/api/chains/${chainId}/report-deployed`, { method: "POST" });
    await loadDashboard();
    if (res.chatMessage) showChatModal("Einsatz gemeldet", res.chatMessage);
  } catch (err) {
    alert(err.message);
  }
};

window.confirmDeployed = async (chainId) => {
  try {
    const res = await api(`/api/chains/${chainId}/confirm-deployed`, { method: "POST" });
    await loadDashboard();
    if (res.chatMessage) showChatModal("Einsatz dokumentiert", res.chatMessage);
  } catch (err) {
    alert(err.message);
  }
};

window.toggleActive = async (userId, isActiveInList) => {
  await api(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ isActiveInList }),
  });
  await loadDashboard();
};

window.toggleExempt = async (userId, isVolunteerExempt) => {
  await api(`/api/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify({ isVolunteerExempt }),
  });
  await loadDashboard();
};

window.markPaid = async (eventId) => {
  await api(`/api/events/${eventId}/payment`, { method: "POST" });
  await loadDashboard();
};

window.openHardshipById = (eventId) => {
  const ev = state.data.events.find((e) => e.id === eventId);
  if (ev) openHardshipModal(ev);
};

window.submitHardship = async (eventId, decision) => {
  const waivedAmountCents = Number(document.getElementById("hs-waive")?.value || 0);
  await api(`/api/events/${eventId}/hardship`, {
    method: "POST",
    body: JSON.stringify({ decision, waivedAmountCents }),
  });
  state.modal = null;
  await loadDashboard();
};

window.settlePayout = async (chainId) => {
  await api(`/api/chains/${chainId}/settle-payout`, { method: "POST" });
  await loadDashboard();
};

window.openSettlePlayerModal = (playerId) => {
  const p = (state.data?.players || []).find((u) => u.id === Number(playerId));
  if (!p) return;

  // Sammle alle bereiten Töpfe
  const readyChains = [];
  for (const g of state.data.games) {
    for (const ch of g.chains) {
      if (
        ch.current_assignee_id === p.id &&
        ch.status === "CONFIRMED_DEPLOYED" &&
        !ch.payout_settled &&
        ch.payout_pool_cents > 0
      ) {
        readyChains.push({ g, ch });
      }
    }
  }

  // Sammle alle offenen Weitergabe-Gebühren
  const openEvents = (state.data.events || []).filter(
    (e) => e.from_user_id === p.id && e.payment_status === "OPEN" && getRemainingOpenCents(e) > 0
  );

  const totalPayoutCreditCents = readyChains.reduce(
    (acc, { ch }) => acc + (ch.payout_pool_cents || 0),
    0
  );
  const totalOpenFeeCents = openEvents.reduce(
    (acc, e) => acc + getRemainingOpenCents(e),
    0
  );
  const netBalanceCents = totalPayoutCreditCents - totalOpenFeeCents;

  state.modal = {
    type: "settlePlayer",
    player: p,
    readyChains,
    openEvents,
    totalPayoutCreditCents,
    totalOpenFeeCents,
    netBalanceCents,
  };
  render();
};

window.executeSettlePlayer = async (playerId) => {
  const offsetRadio = document.getElementById("settle-mode-offset");
  const offsetOpenFees = offsetRadio ? offsetRadio.checked : false;

  try {
    const res = await api("/api/treasury/settle-player", {
      method: "POST",
      body: JSON.stringify({
        playerId,
        offsetOpenFees,
        seasonId: state.selectedSeasonId || state.data?.season?.id,
      }),
    });
    state.modal = null;
    await loadDashboard();

    const info = offsetOpenFees
      ? `Sammelabwicklung erfolgreich!\n\nVerrechnete Gebühren: ${formatEuro(res.totalOffsetAmountCents)}\nAusbezahltes Netto-Guthaben: ${formatEuro(res.netPayoutCents)}`
      : `Sammelauszahlung erfolgreich!\n\nAusbezahlte Töpfe: ${res.settledPoolCount} (${formatEuro(res.totalPayoutCreditCents)})`;
    alert(info);
  } catch (err) {
    alert(err.message);
  }
};

window.setChainFilter = (f) => {
  state.chainFilterStatus = f;
  render();
};

window.toggleChainShowAll = () => {
  state.chainShowAllSlots = !state.chainShowAllSlots;
  render();
};

window.setChainSearch = (val, cursorPos) => {
  state.chainSearch = val;
  render();
  const el = document.getElementById("chain-search-input");
  if (el) {
    el.focus();
    const pos = typeof cursorPos === "number" ? cursorPos : val.length;
    el.setSelectionRange(pos, pos);
  }
};

window.setStatsSearch = (val, cursorPos) => {
  state.statsSearch = val;
  render();
  const el = document.getElementById("stats-search-input");
  if (el) {
    el.focus();
    const pos = typeof cursorPos === "number" ? cursorPos : val.length;
    el.setSelectionRange(pos, pos);
  }
};

window.setStatsSort = (sort) => {
  state.statsSort = sort;
  render();
};

// --- Erinnerungs- & Vorlagen-Funktionen ---
function openReminderModal({ title, subtitle, message, recipientUser, isGroupShare }) {
  state.modal = {
    type: "reminder",
    title,
    subtitle,
    message,
    recipientUser: recipientUser || null,
    isGroupShare: Boolean(isGroupShare),
  };
  render();
}

window.copyIbanToClipboard = (iban) => {
  if (!iban) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(iban).then(() => {
      alert(`IBAN kopiert: ${iban}`);
    });
  } else {
    prompt("IBAN zum Kopieren:", iban);
  }
};

window.copyReminderText = () => {
  const box = document.getElementById("reminder-msg-box");
  const text = box ? box.value : "";
  if (!text) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      alert("Text in die Zwischenablage kopiert!");
    });
  } else {
    box.select();
    document.execCommand("copy");
    alert("Text kopiert!");
  }
};

window.openWhatsAppWithReminder = (phoneClean) => {
  const box = document.getElementById("reminder-msg-box");
  const text = box ? box.value : "";
  let url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  if (phoneClean && phoneClean.length >= 8) {
    url = `https://wa.me/${phoneClean}?text=${encodeURIComponent(text)}`;
  }
  window.open(url, "_blank", "noopener,noreferrer");
};

// 1. Spieltags-Erinnerung für Schiri (nur Schiedsrichterwart & Admin)
window.openGameReminderModal = (gameId, chainId) => {
  if (state.user?.role !== "SCHIEDSRICHTERWART" && state.user?.role !== "ADMIN") return;
  const g = state.data?.games?.find((game) => game.id === Number(gameId));
  if (!g) return;
  const ch = g.chains.find((c) => c.id === Number(chainId));
  if (!ch) return;
  const targetUser = ch.pendingAssignee || ch.currentAssignee;
  if (!targetUser) return;

  const otherChain = g.chains.find((c) => c.id !== ch.id);
  const otherUser = otherChain ? otherChain.pendingAssignee || otherChain.currentAssignee : null;
  const partnerName = otherUser ? fullName(otherUser) : "noch offen";

  const d = new Date(g.kickoff_at);
  const weekday = d.toLocaleDateString("de-DE", { weekday: "long" });
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const dateStr = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  const msg = `Moin ${targetUser.first_name},\n\nkurze Erinnerung an deinen Schiedsrichter-Einsatz am ${weekday}, ${dateStr} um ${time} Uhr:\n🏑 Spiel: ${g.title}\n📍 Halle: ${g.location || "RHTC Halle"}\n👥 Schiri-Partner: ${partnerName}\n\nBitte sei ca. 20 Minuten vor Anpfiff in der Halle. Gut Pfiff!\n\n(Details in der Schiri-App)`;

  openReminderModal({
    title: "💬 Spieltags-Erinnerung",
    subtitle: `Erinnerung für ${fullName(targetUser)} vor dem Spiel`,
    message: msg,
    recipientUser: targetUser,
    isGroupShare: false,
  });
};

// 2. Rückbestätigungs-Erinnerung (falls noch unbestätigt)
window.openConfirmationReminderModal = (gameId, chainId) => {
  const g = state.data?.games?.find((game) => game.id === Number(gameId));
  if (!g) return;
  const ch = g.chains.find((c) => c.id === Number(chainId));
  if (!ch) return;
  const targetUser = ch.pendingAssignee || ch.currentAssignee;
  if (!targetUser) return;

  const dateStr = formatDate(g.kickoff_at);
  const msg = `Moin ${targetUser.first_name},\n\ndu bist für das folgende Spiel als Schiedsrichter angesetzt:\n🏑 ${g.title}\n📅 ${dateStr} (Slot ${ch.slot_number})\n\nBitte bestätige deine Ansetzung kurz in der Schiri-App oder leite den Slot rechtzeitig weiter, falls du verhindert bist.\n\nDanke dir!`;

  openReminderModal({
    title: "⏰ Rückbestätigung anfordern",
    subtitle: `Freundliche Erinnerung zur Bestätigung an ${fullName(targetUser)}`,
    message: msg,
    recipientUser: targetUser,
    isGroupShare: false,
  });
};

// 3. Dringender Übernahme-Aufruf an Gruppenchat
window.openUrgentBroadcastModal = (gameId) => {
  const g = state.data?.games?.find((game) => game.id === Number(gameId));
  if (!g) return;

  const totalPot = (g.chains || []).reduce((acc, c) => acc + (c.payout_pool_cents || 0), 0);
  const dateStr = formatDate(g.kickoff_at);

  let msg = `🚨 Dringend Schiedsrichter gesucht!\n\nFür unser Hallenspiel:\n🏑 ${g.title}\n📅 ${dateStr}\n📍 ${g.location || "RHTC Halle"}\n\nist noch mindestens ein Schiedsrichter-Slot unbesetzt!`;
  if (totalPot > 0) {
    msg += `\n💰 Dem Übernehmer winkt ein Prämientopf von aktuell ${formatEuro(totalPot)}!`;
  }
  msg += `\n\nWer kann einspringen? Bitte direkt in der App auf „Freiwillig übernehmen“ tippen!\nDanke für euren Einsatz! 🏑`;

  openReminderModal({
    title: "🚨 Dringender Übernahme-Aufruf",
    subtitle: `Aufruf für den WhatsApp-Gruppenchat der 2. Herren`,
    message: msg,
    recipientUser: null,
    isGroupShare: true,
  });
};

// 4. Zahlungserinnerung für Einzel-Event
window.openPaymentReminderModal = (eventId) => {
  const ev = (state.data?.events || []).find((e) => e.id === Number(eventId));
  if (!ev) return;
  const targetUser = ev.fromUser;
  if (!targetUser) return;

  const g = state.data?.games?.find((game) => game.id === ev.game_id);
  const ch = g?.chains?.find((c) => c.id === ev.chain_id);
  const refCode = ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : `SR-${ev.chain_id}`);
  const gameTitle = g ? g.title : "Schiedsrichter-Ansetzung";
  const due = getRemainingOpenCents(ev);

  const ts = state.data?.treasurySettings || {};
  const ibanStr = ts.iban ? `\n🏦 IBAN: ${ts.iban}\n👤 Empfänger: ${ts.recipient || "RHTC 2. Herren Kasse"}` : "";
  const paypalUrl = buildPayPalUrl(ts.paypal, due, `${refCode} ${gameTitle}`);
  const paypalStr = paypalUrl ? `\n💳 PayPal: ${paypalUrl}` : "";
  const refText = `${refCode} – Weitergabe ${gameTitle}`;

  const msg = `Moin ${targetUser.first_name},\n\nkurze Erinnerung von der Mannschaftskasse: Für deine Weitergabe beim Spiel „${gameTitle}“ (${refCode}) steht noch die Gebühr von ${formatEuro(due)} offen.\n\nBitte überweise den Betrag zeitnah:${ibanStr}${paypalStr}\nVerwendungszweck: ${refText} (${targetUser.last_name})\n\nVielen Dank!`;

  openReminderModal({
    title: "💬 Zahlungserinnerung senden",
    subtitle: `Mahnung / Zahlungserinnerung an ${fullName(targetUser)} (${formatEuro(due)})`,
    message: msg,
    recipientUser: targetUser,
    isGroupShare: false,
  });
};

// 5. Sammel-Zahlungserinnerung für alle offenen Gebühren eines Spielers
window.openPlayerFeeReminderModal = (playerId) => {
  const p = (state.data?.players || []).find((u) => u.id === Number(playerId));
  if (!p) return;

  const openEvents = (state.data?.events || []).filter(
    (e) => e.from_user_id === p.id && e.payment_status === "OPEN" && getRemainingOpenCents(e) > 0
  );
  const totalOpenFeeCents = openEvents.reduce(
    (acc, e) => acc + getRemainingOpenCents(e),
    0
  );

  const openRefCodes = openEvents.map((ev) => {
    const g = state.data?.games?.find((game) => game.id === ev.game_id);
    const ch = g?.chains?.find((c) => c.id === ev.chain_id);
    return ch?.ref_code || (ch?.slot_number ? `Slot ${ch.slot_number}` : "");
  }).filter(Boolean);
  const refCodeStr = openRefCodes.length > 0 ? ` (${openRefCodes.join(", ")})` : "";

  const ts = state.data?.treasurySettings || {};
  const ibanStr = ts.iban ? `\n🏦 IBAN: ${ts.iban}\n👤 Empfänger: ${ts.recipient || "RHTC 2. Herren Kasse"}` : "";
  const paypalUrl = buildPayPalUrl(ts.paypal, totalOpenFeeCents, openRefCodes.join(", "));
  const paypalStr = paypalUrl ? `\n💳 PayPal: ${paypalUrl}` : "";

  const msg = `Moin ${p.first_name},\n\nkurze Erinnerung von der Mannschaftskasse: Du hast aktuell ${openEvents.length} offene Weitergabe-Gebühr(en) in Höhe von insgesamt ${formatEuro(totalOpenFeeCents)}.${refCodeStr ? `\nBetroffene Slots: ${openRefCodes.join(", ")}` : ""}\n\nBitte begleiche den Betrag zeitnah:${ibanStr}${paypalStr}\nVerwendungszweck: Weitergabe-Gebühren ${openRefCodes.join(" ")} (${p.last_name})\n\nVielen Dank!`;

  openReminderModal({
    title: "💬 Gesamte Zahlungserinnerung senden",
    subtitle: `Erinnerung über ${formatEuro(totalOpenFeeCents)} an ${fullName(p)}`,
    message: msg,
    recipientUser: p,
    isGroupShare: false,
  });
};

window.openTreasurySettingsModal = () => {
  state.modal = { type: "treasurySettings" };
  render();
};

window.copyChatMsg = () => {
  const text = document.getElementById("chat-msg-box").innerText;
  navigator.clipboard.writeText(text);
  alert("Text für den Gruppenchat kopiert!");
};

function openPlayerDetailModal(playerId) {
  const p = (state.data?.players || []).find((u) => u.id === Number(playerId));
  if (!p) return;
  state.modal = { type: "playerDetail", player: p };
  render();
}

window.toggleMobileAccordion = (rowId, btnEl) => {
  const row = document.getElementById(rowId);
  if (!row) return;
  const isOpen = row.classList.toggle("is-open");
  if (btnEl) {
    const arrow = btnEl.querySelector(".acc-arrow");
    if (arrow) arrow.textContent = isOpen ? "▴" : "▾";
  }
};

window.openPlayerDetailModal = openPlayerDetailModal;
window.openHandoffModal = openHandoffModal;
window.openAddGameModal = openAddGameModal;
window.openEditGameModal = openEditGameModal;
window.openManualAssignModal = openManualAssignModal;
window.openAddPlayerModal = openAddPlayerModal;
window.openImportCsvModal = openImportCsvModal;
window.openImportGamesCsvModal = openImportGamesCsvModal;
window.openAddSeasonModal = openAddSeasonModal;
window.openEditSeasonModal = openEditSeasonModal;
window.openProfileModal = openProfileModal;
window.openEditPlayerModal = openEditPlayerModal;
window.openHardshipModal = openHardshipModal;
window.closeModal = closeModal;

// --- PWA Installation & Service Worker ---
let deferredPrompt = null;
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const bar = document.getElementById("pwa-install-bar");
    if (bar) bar.style.display = "flex";
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    });
  }
}

function renderInstallBannerHtml() {
  if (typeof window === "undefined") return "";
  const isStandalone =
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    navigator.standalone === true;
  if (isStandalone) return "";
  if (localStorage.getItem("rhtc_hide_pwa_banner") === "true") return "";

  return `
    <div class="pwa-install-banner" id="pwa-install-bar">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="/icon-192.png" width="30" height="30" style="border-radius:6px;box-shadow:0 1px 3px rgba(0,0,0,0.3)" alt="App Icon" />
        <div>
          <strong style="font-size:0.86rem;color:#ffffff;display:block">RHTC Schiri als App installieren</strong>
          <span style="font-size:0.75rem;color:rgba(255,255,255,0.8)">Direkt vom Startbildschirm aufrufen &bull; Schneller Start</span>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button class="btn btn-sm" style="background:#fbbf24;color:#0f2b48;font-weight:700;border:none;padding:5px 12px;font-size:0.8rem;cursor:pointer;border-radius:5px" onclick="triggerPwaInstall()">App holen</button>
        <button style="background:transparent;border:none;color:#ffffff;font-size:1.1rem;cursor:pointer;padding:4px 8px;opacity:0.75" onclick="dismissInstallBanner()" title="Ausblenden">&times;</button>
      </div>
    </div>
  `;
}

window.triggerPwaInstall = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    window.dismissInstallBanner();
  } else {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIos) {
      alert(
        "App auf dem iPhone/iPad installieren:\n\n1. Tippe unten im Safari auf das 'Teilen'-Symbol (Viereck mit Pfeil nach oben).\n2. Scrolle etwas nach unten und wähle 'Zum Home-Bildschirm'.\n3. Tippe oben rechts auf 'Hinzufügen'."
      );
    } else {
      alert(
        "App installieren:\n\nTippe im Browser-Menü (drei Punkte oben rechts) auf 'App installieren' oder 'Zum Startbildschirm hinzufügen'."
      );
    }
  }
};

window.dismissInstallBanner = () => {
  localStorage.setItem("rhtc_hide_pwa_banner", "true");
  const bar = document.getElementById("pwa-install-bar");
  if (bar) bar.style.display = "none";
};

// --- Kalender-Export & WebCal-Abo ---
window.copyCalLink = (url) => {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(url)
      .then(() => {
        alert(
          "Kalender-Abo-Link in die Zwischenablage kopiert!\n\nDu kannst ihn in Google Kalender, Apple Kalender oder Outlook unter 'Kalender abonnieren / per URL hinzufügen' einfügen."
        );
      })
      .catch(() => {
        prompt("Kalender-Abo-Link kopieren:", url);
      });
  } else {
    prompt("Kalender-Abo-Link kopieren:", url);
  }
};

window.downloadGameIcs = (chainId) => {
  let targetGame = null;
  let targetChain = null;
  for (const g of state.data?.games || []) {
    for (const ch of g.chains || []) {
      if (ch.id === chainId) {
        targetGame = g;
        targetChain = ch;
        break;
      }
    }
    if (targetChain) break;
  }
  if (!targetGame || !targetChain) {
    alert("Spiel nicht gefunden.");
    return;
  }

  const partnerChain = targetGame.chains?.find((c) => c.id !== targetChain.id);
  const partnerId =
    partnerChain?.current_assignee_id || partnerChain?.pending_assignee_id;
  const partner = partnerId
    ? state.data?.players?.find((p) => p.id === partnerId)
    : null;
  let partnerText = "Offen / noch nicht besetzt";
  if (partner) {
    partnerText = `${partner.first_name} ${partner.last_name}`;
    if (partner.mobile_number) {
      partnerText += ` (Mobil: ${partner.mobile_number})`;
    }
  }

  const kickoff = new Date(targetGame.kickoff_at);
  const end = new Date(kickoff.getTime() + 90 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const formatUtc = (d) =>
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

  const nowStr = formatUtc(new Date());
  const startStr = formatUtc(kickoff);
  const endStr = formatUtc(end);

  const desc = [
    `Schiedsrichter-Einsatz: Slot ${targetChain.slot_number}`,
    `Schiri-Code: ${targetChain.ref_code || "-"}`,
    `Status: ${targetChain.status === "CONFIRMED" ? "Bestätigt" : "Offen / Unbestätigt"}`,
    `Schiri-Partner: ${partnerText}`,
    `Ort/Halle: ${targetGame.location || "RHTC Hamburg"}`,
  ].join("\\n");

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RHTC Hamburg//Schiedsrichter Portal//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:rhtc-chain-${targetChain.id}@rhtc.de`,
    `DTSTAMP:${nowStr}`,
    `DTSTART:${startStr}`,
    `DTEND:${endStr}`,
    `SUMMARY:RHTC Schiri: ${targetGame.title} (Slot ${targetChain.slot_number})`,
    `LOCATION:${targetGame.location || "RHTC Hamburg"}`,
    `DESCRIPTION:${desc}`,
    `STATUS:${targetChain.status === "CONFIRMED" ? "CONFIRMED" : "TENTATIVE"}`,
    "BEGIN:VALARM",
    "TRIGGER:-P1D",
    "ACTION:DISPLAY",
    "DESCRIPTION:Erinnerung: Schiri-Einsatz morgen",
    "END:VALARM",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Erinnerung: Schiri-Einsatz in 2 Stunden",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rhtc-spiel-${targetGame.id}-slot-${targetChain.slot_number}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// --- Dropdown Menu Toggles for Game Cards & Slots ---
window.toggleSlotDropdown = (event, chainId) => {
  event.stopPropagation();
  const menu = document.getElementById(`slot-menu-${chainId}`);
  const wasShown = menu?.classList.contains("show");
  document.querySelectorAll(".slot-dropdown-menu.show").forEach((m) => m.classList.remove("show"));
  if (menu && !wasShown) {
    menu.classList.add("show");
  }
};

window.toggleGameMenu = (event, gameId) => {
  event.stopPropagation();
  const menu = document.getElementById(`game-menu-${gameId}`);
  const wasShown = menu?.classList.contains("show");
  document.querySelectorAll(".slot-dropdown-menu.show").forEach((m) => m.classList.remove("show"));
  if (menu && !wasShown) {
    menu.classList.add("show");
  }
};

if (typeof window !== "undefined") {
  window.addEventListener("click", (e) => {
    if (!e.target.closest(".slot-split-btn-group") && !e.target.closest(".game-options-wrap")) {
      document.querySelectorAll(".slot-dropdown-menu.show").forEach((m) => m.classList.remove("show"));
    }
  });
}

window.copyGameWhatsAppInfo = (gameId) => {
  const g = state.data?.games?.find((game) => game.id === gameId);
  if (!g) return;
  const d = new Date(g.kickoff_at);
  const pad = (n) => String(n).padStart(2, "0");
  const weekdays = ["SO", "MO", "DI", "MI", "DO", "FR", "SA"];
  const dateStr = `${weekdays[d.getDay()]}, ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`;

  let ref1 = "offen";
  let ref2 = "offen";
  const ch1 = g.chains?.find((c) => c.slot_number === 1);
  const ch2 = g.chains?.find((c) => c.slot_number === 2);
  if (ch1) {
    const u = ch1.pendingAssignee || ch1.currentAssignee;
    ref1 = u ? `${u.first_name} ${u.last_name}` : "offen";
    if (ch1.status === "CONFIRMED") ref1 += " (bestätigt)";
  }
  if (ch2) {
    const u = ch2.pendingAssignee || ch2.currentAssignee;
    ref2 = u ? `${u.first_name} ${u.last_name}` : "offen";
    if (ch2.status === "CONFIRMED") ref2 += " (bestätigt)";
  }

  const text = `🏑 *RHTC 2. Herren – Schiriansetzung*\n` +
    `*Spiel:* ${g.title}\n` +
    `*Termin:* ${dateStr} um ${timeStr}\n` +
    `*Ort:* ${g.location || "RHTC"}\n` +
    `*Schiri 1:* ${ref1}\n` +
    `*Schiri 2:* ${ref2}`;

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        alert("Spiel-Informationen für WhatsApp kopiert!\n\nDu kannst den Text direkt in die Mannschaftsgruppe einfügen.");
      })
      .catch(() => {
        prompt("Spiel-Info kopieren:", text);
      });
  } else {
    prompt("Spiel-Info kopieren:", text);
  }
};

window.saveStatsOverrides = async function (playerId) {
  if (!playerId) return;
  const depEl = document.getElementById("sov-deployed");
  const earEl = document.getElementById("sov-earned");
  const takEl = document.getElementById("sov-takeover");
  const hanEl = document.getElementById("sov-handoff");

  const depVal = depEl ? depEl.value.trim() : null;
  const earVal = earEl ? earEl.value.trim() : null;
  const takVal = takEl ? takEl.value.trim() : null;
  const hanVal = hanEl ? hanEl.value.trim() : null;

  try {
    const payload = {
      seasonId: state.selectedSeasonId || state.data?.season?.id,
    };
    if (depVal !== null && depVal !== "") {
      payload.deployedCount = Math.max(0, parseInt(depVal, 10) || 0);
    } else if (depVal === "") {
      payload.deployedCount = null;
    }
    if (earVal !== null && earVal !== "") {
      payload.earnedPayoutCents = Math.max(0, Math.round(parseFloat(earVal.replace(",", ".")) * 100) || 0);
    } else if (earVal === "") {
      payload.earnedPayoutCents = null;
    }
    if (takVal !== null && takVal !== "") {
      payload.takeoverCount = Math.max(0, parseInt(takVal, 10) || 0);
    } else if (takVal === "") {
      payload.takeoverCount = null;
    }
    if (hanVal !== null && hanVal !== "") {
      payload.handoffCount = Math.max(0, parseInt(hanVal, 10) || 0);
    } else if (hanVal === "") {
      payload.handoffCount = null;
    }

    await api(`/api/users/${playerId}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    // Aktualisiere modal player falls noch offen
    if (state.modal?.player?.id === playerId) {
      if (depVal !== null && depVal !== "") {
        state.modal.player.deployedCount = Math.max(0, parseInt(depVal, 10) || 0);
        state.modal.player.isDeployedOverridden = true;
      }
      if (earVal !== null && earVal !== "") {
        state.modal.player.earnedPayoutCents = Math.max(0, Math.round(parseFloat(earVal.replace(",", ".")) * 100) || 0);
        state.modal.player.isEarnedOverridden = true;
      }
      if (takVal !== null && takVal !== "") {
        state.modal.player.takeoverCount = Math.max(0, parseInt(takVal, 10) || 0);
        state.modal.player.isTakeoverOverridden = true;
      }
      if (hanVal !== null && hanVal !== "") {
        state.modal.player.handoffCount = Math.max(0, parseInt(hanVal, 10) || 0);
        state.modal.player.isHandoffOverridden = true;
      }
    }
    await loadDashboard();
  } catch (err) {
    alert("Fehler beim Speichern: " + err.message);
  }
};

loadDashboard();
