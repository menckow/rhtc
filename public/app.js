const state = {
  user: null,
  data: null,
  selectedSeasonId: null,
  tab: "games", // games | calendar | tasks | chains | players | treasury | docs
  calendarYear: new Date().getFullYear(),
  calendarMonth: new Date().getMonth(),
  showPastDeployed: false,
  gameFilter: "all", // all | mine | bounty
  chainFilterStatus: "all", // all | active | deployed | open_payment
  chainShowAllSlots: false,
  chainSearch: "",
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
    CONFIRMED: ["Bestätigt", "badge-blue"],
    VOLUNTARY_REQUESTED: ["Übernahme angefragt", "badge-amber"],
    REPORTED_DEPLOYED: ["Gepfiffen (gemeldet)", "badge-amber"],
    CONFIRMED_DEPLOYED: ["Eingesetzt (§ 1 Abs. 4)", "badge-green"],
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
    const qs = state.selectedSeasonId
      ? `?seasonId=${state.selectedSeasonId}`
      : "";
    const data = await api(`/api/dashboard${qs}`);
    state.user = data.user;
    state.data = data;
    if (state.data?.season) {
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

function renderLogin() {
  return `
    <div class="login-wrap">
      <div class="login-brand">
        <div class="brand-crest">${RHTC_CREST_SVG}</div>
        <div>
          <div style="font-weight:800;font-size:1.1rem">RHTC – 2. Herren</div>
          <div style="font-size:0.78rem;color:var(--gold);font-weight:600">Schwarz-Gold &bull; Schiedsrichterverwaltung</div>
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
            <input type="email" id="login-email" required placeholder="z. B. albers@rhtc.de" />
          </div>
          <div class="form-group">
            <label>Passwort</label>
            <input type="password" id="login-password" required value="rhtc2026" />
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%;justify-content:center">Anmelden</button>
        </form>
        <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:12px">
          <div style="font-size:0.8rem;color:var(--muted);font-weight:600">Schnell-Login (Demo-Accounts, Passwort: rhtc2026):</div>
          <div class="quick-logins">
            <button class="btn btn-outline btn-sm" onclick="quickLogin('albers@rhtc.de')">Spieler (Albers)</button>
            <button class="btn btn-outline btn-sm" onclick="quickLogin('claasen@rhtc.de')">Spieler (Claasen)</button>
            <button class="btn btn-outline btn-sm" onclick="quickLogin('grote@rhtc.de')">Bereits eingesetzt (Grote)</button>
            <button class="btn btn-outline btn-sm" onclick="quickLogin('becker@rhtc.de')">Schiedsrichterwart (Becker)</button>
            <button class="btn btn-outline btn-sm" onclick="quickLogin('dierks@rhtc.de')">Kassenwart (Dierks)</button>
            <button class="btn btn-outline btn-sm" onclick="quickLogin('franke@rhtc.de')">Vorstand (Franke)</button>
          </div>
        </div>
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
      <h2 style="margin:0;font-size:1.1rem">Hallenspiele &amp; Schiedsrichter-Ansetzungen (§ 3)</h2>
      <div class="btn-row" style="margin:0">
        ${
          hiddenCount > 0
            ? `<button class="btn btn-outline btn-sm" onclick="togglePastDeployed()">${state.showPastDeployed ? "Vergangene eingesetzte ausblenden" : `Vergangene eingesetzte anzeigen (${hiddenCount})`}</button>`
            : ""
        }
        ${isWart ? `<button class="btn btn-outline btn-sm" onclick="openImportGamesCsvModal()">Spielplan-CSV</button>` : ""}
        ${isWart ? `<button class="btn btn-primary" onclick="openAddGameModal()">+ Neues Spiel ansetzen</button>` : ""}
      </div>
    </div>
  `;

  if (bountySlots.length > 0) {
    html += `
      <div class="bounty-banner">
        <div class="bounty-banner-title">Offene Übernahme-Prämien (Finanzieller Topf)</div>
        <div class="bounty-list">
          ${bountySlots
            .map(({ g, ch }) => {
              const canTake = canVolunteerForChain(ch);
              return `
                <div class="bounty-item">
                  <div>
                    <div style="font-weight:700;font-size:0.88rem">${esc(g.title)}</div>
                    <div style="font-size:0.76rem;color:#d6d1c4">${formatDate(g.kickoff_at)} &bull; ${esc(ch.ref_code || `Slot ${ch.slot_number}`)}</div>
                  </div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="bounty-amount">+${formatEuro(ch.payout_pool_cents)}</span>
                    ${
                      canTake
                        ? `<button class="btn btn-warn btn-sm" onclick="requestVolunteer(${ch.id})">Übernehmen</button>`
                        : ""
                    }
                  </div>
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

  for (const game of games) {
    html += `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
          <div>
            <div style="font-weight:700;font-size:1.05rem">${esc(game.title)}</div>
            <div style="font-size:0.84rem;color:var(--muted)">
              ${formatDate(game.kickoff_at)} &bull; ${esc(game.location)}
              ${game.is_first_game_of_season ? `<span class="badge badge-gray" style="margin-left:6px">1. Saisonspiel (§ 3 Abs. 3)</span>` : ""}
            </div>
          </div>
          ${
            isWart
              ? `<div class="btn-row" style="margin:0">
                  <button class="btn btn-outline btn-sm" onclick="openEditGameModal(${game.id})">Spiel bearbeiten</button>
                  <button class="btn btn-danger btn-sm" onclick="deleteGame(${game.id}, '${esc(game.title)}')">Löschen</button>
                </div>`
              : ""
          }
        </div>
        <div class="grid-2">
    `;

    for (const ch of game.chains) {
      const responsibleId = ch.pending_assignee_id ?? ch.current_assignee_id;
      const isResponsible = responsibleId === state.user.id;
      const isUnconfirmed =
        ch.status === "ASSIGNED" || ch.status === "PENDING_HANDOFF";

      html += `
        <div class="slot-box ${ch.payout_pool_cents > 0 ? "has-pot" : ""}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong>${ch.ref_code ? `<span class="badge badge-gray" style="margin-right:6px">${esc(ch.ref_code)}</span>` : ""}Schiri-Slot ${ch.slot_number} <span style="font-weight:400;color:var(--muted);font-size:0.8rem">(Runde ${ch.round_number})</span></strong>
            ${statusBadge(ch.status)}
          </div>
          <div style="font-size:0.9rem">
            ${ch.pendingAssignee ? `Vorgeschlagen: <strong>${esc(fullName(ch.pendingAssignee))}</strong>` : `Zugewiesen: <strong>${esc(fullName(ch.currentAssignee))}</strong>`}
            ${isResponsible ? `<span class="badge badge-blue" style="margin-left:4px">Du</span>` : ""}
          </div>
          ${ch.voluntaryRequester ? `<div style="font-size:0.85rem;color:var(--warn);margin-top:4px">Übernahme angefragt von: <strong>${esc(fullName(ch.voluntaryRequester))}</strong></div>` : ""}
          ${
            ch.payout_pool_cents > 0
              ? `<div class="pot-banner">
                  <span>Übernahme-Prämie im Topf</span>
                  <span>+${formatEuro(ch.payout_pool_cents)} ${ch.payout_settled ? "(ausgezahlt)" : ""}</span>
                </div>`
              : ""
          }
          ${renderChainSteps(ch)}

          <div class="btn-row">
            ${
              (isResponsible || isWart) && isUnconfirmed
                ? `
                  <button class="btn btn-success btn-sm" onclick="respondHandoff(${ch.id}, 'ACCEPT')">Annehmen (Bestätigen)</button>
                  <button class="btn btn-outline btn-sm" onclick="handoffById(${ch.id})">Weiterleiten</button>
                  <button class="btn btn-outline btn-sm" onclick="downloadGameIcs(${ch.id})" title="Als Kalender-Termin (.ics) herunterladen">📅 In Kalender</button>
                `
                : ""
            }
            ${
              (isResponsible || isWart) && ch.status === "CONFIRMED"
                ? `
                  <button class="btn btn-outline btn-sm" onclick="downloadGameIcs(${ch.id})" title="Als Kalender-Termin (.ics) herunterladen">📅 In Kalender</button>
                  <button class="btn btn-outline btn-sm" onclick="handoffById(${ch.id})">Weiterleiten</button>
                  ${
                    new Date(game.kickoff_at).getTime() <= Date.now() || isWart
                      ? `<button class="btn btn-primary btn-sm" onclick="reportDeployed(${ch.id})">Als gepfiffen melden (§ 6.2)</button>`
                      : ""
                  }
                `
                : ""
            }
            ${
              isWart && (ch.status === "REPORTED_DEPLOYED" || ch.status === "CONFIRMED" || ch.status === "ASSIGNED")
                ? `<button class="btn btn-success btn-sm" onclick="confirmDeployed(${ch.id})">Einsatz bestätigen (§ 6.1)</button>`
                : ""
            }
            ${
              isWart && ch.status !== "CONFIRMED_DEPLOYED"
                ? `<button class="btn btn-outline btn-sm" onclick="openManualAssignModal(${ch.id})">Manuell zuweisen</button>`
                : ""
            }
            ${
              canVolunteerForChain(ch)
                ? `<button class="btn ${ch.payout_pool_cents > 0 ? "btn-warn" : "btn-outline"} btn-sm" onclick="requestVolunteer(${ch.id})">${ch.payout_pool_cents > 0 ? `Übernehmen (+${formatEuro(ch.payout_pool_cents)})` : "Unbestätigtes Spiel übernehmen"}</button>`
                : ""
            }
            ${
              (isResponsible || isWart) && ch.status === "VOLUNTARY_REQUESTED"
                ? `
                  <button class="btn btn-success btn-sm" onclick="decideVolunteer(${ch.id}, 'APPROVE')">Übernahme bestätigen</button>
                  <button class="btn btn-danger btn-sm" onclick="decideVolunteer(${ch.id}, 'REJECT')">Ablehnen (selbst pfeifen)</button>
                `
                : ""
            }
          </div>
        </div>
      `;
    }

    html += `</div></div>`;
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

  if (pendingForMe.length === 0 && voluntaryRequestsForMe.length === 0) {
    html += `<div class="alert alert-info">Aktuell liegen keine offenen Anfragen für dich vor.</div>`;
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
    <div class="card">
      <table class="players-table">
        <thead>
          <tr>
            ${isWart ? `<th style="width:32px"><input type="checkbox" ${allSelected ? "checked" : ""} onchange="toggleSelectAllPlayers(this.checked)" title="Alle auswählen" /></th>` : ""}
            <th style="width:42px">#</th>
            <th>Spieler &amp; Kontakt</th>
            <th>Status</th>
            <th>Einsätze</th>
            <th>Offen</th>
            ${isWart ? `<th>Aktion</th>` : ""}
          </tr>
        </thead>
        <tbody>
  `;

  state.data.players.forEach((p, idx) => {
    const isSelf = p.id === state.user.id;
    const isChecked = state.selectedPlayerIds.includes(p.id);
    html += `
      <tr>
        ${
          isWart
            ? `<td data-label="Auswahl"><input type="checkbox" ${isChecked ? "checked" : ""} ${isSelf ? "disabled title='Eigener Account'" : ""} onchange="toggleSelectPlayer(${p.id}, this.checked)" /></td>`
            : ""
        }
        <td data-label="#">${idx + 1}${p.list_order_override !== null && p.list_order_override !== undefined ? ` <span class="badge badge-gray" title="Manuelle Position (§ 2 Abs. 4)">#${p.list_order_override}</span>` : ""}</td>
        <td class="cell-main">
          <div><strong>${esc(p.last_name)}, ${esc(p.first_name)}</strong> <span class="badge badge-gray">${roleLabel(p.role)}</span></div>
          <div class="player-meta">${esc(p.email)}${p.mobile_number ? ` &bull; ${esc(p.mobile_number)}` : ""}</div>
        </td>
        <td data-label="Status">
          <div class="player-badges">
            ${p.is_active_in_list ? `<span class="badge badge-green">Aktiv</span>` : `<span class="badge badge-gray">Ausgenommen</span>`}
            ${p.is_volunteer_exempt ? `<span class="badge badge-blue">Ehrenamt (§ 7)</span>` : ""}
          </div>
        </td>
        <td data-label="Einsätze"><strong>${p.deployedCount}</strong> eingesetzt / ${p.activeAssigned} anges.</td>
        <td data-label="Offen">${p.openPaymentCents > 0 ? `<strong style="color:var(--danger)">${formatEuro(p.openPaymentCents)}</strong>` : "0,00 €"}</td>
        ${
          isWart
            ? `<td data-label="Aktion">
                <button class="btn btn-primary btn-sm" onclick="openEditPlayerModal(${p.id})">Bearbeiten</button>
              </td>`
            : ""
        }
      </tr>
    `;
  });

  html += `</tbody></table></div>`;
  return html;
}

function renderTreasuryTab() {
  const isKassenwart = state.user.role === "KASSENWART";
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

  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
      <h2 style="margin:0;font-size:1.1rem">Mannschaftskasse, Auszahlungen &amp; Härtefälle (§ 4, § 5, § 8)</h2>
      <button class="btn btn-outline btn-sm" onclick="exportTreasuryCsv()">Kassen-Export (CSV)</button>
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

    <div class="card" style="overflow-x:auto">
      <h3 style="margin-top:0;font-size:1rem">Weitergabe-Zahlungen &amp; Härtefallanträge</h3>
      ${
        paymentEvents.length === 0
          ? `<p style="color:var(--muted)">Noch keine zahlungspflichtigen Weitergaben vorhanden.</p>`
          : `<table class="responsive-table">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th>Von</th>
                  <th>Betrag</th>
                  <th>Status</th>
                  <th>Härtefall (§ 8)</th>
                  ${isKassenwart ? `<th>Aktion</th>` : ""}
                </tr>
              </thead>
              <tbody>
                ${paymentEvents
                  .map((ev) => {
                    const due = ev.fee_total_cents - ev.waived_amount_cents;
                    return `
                      <tr>
                        <td class="cell-main"><strong>${esc(fullName(ev.fromUser))}</strong><div class="player-meta">${formatDate(ev.created_at)}</div></td>
                        <td data-label="Betrag">${formatEuro(due)} ${ev.waived_amount_cents > 0 ? `<span style="font-size:0.75rem;color:var(--muted)">(Erlass: ${formatEuro(ev.waived_amount_cents)})</span>` : ""}</td>
                        <td data-label="Status">${esc(ev.payment_status)}</td>
                        <td data-label="Härtefall (§ 8)">
                          ${ev.hardship_status === "NONE" ? "–" : esc(ev.hardship_status)}
                          ${isKassenwart && ev.hardship_reason_confidential ? `<div style="font-size:0.78rem;color:var(--muted);margin-top:2px">Vertraulich: ${esc(ev.hardship_reason_confidential)}</div>` : ""}
                        </td>
                        ${
                          isKassenwart
                            ? `<td data-label="Aktion">
                                <div class="btn-row" style="margin:0">
                                  ${ev.payment_status === "OPEN" ? `<button class="btn btn-success btn-sm" onclick="markPaid(${ev.id})">Als bezahlt verbuchen</button>` : ""}
                                  ${ev.hardship_status === "PENDING" ? `<button class="btn btn-warn btn-sm" onclick="openHardshipById(${ev.id})">Härtefall prüfen</button>` : ""}
                                </div>
                              </td>`
                            : ""
                        }
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
      ${
        payoutChains.length === 0
          ? `<p style="color:var(--muted)">Keine Auszahlungstöpfe vorhanden.</p>`
          : `<table class="responsive-table">
              <thead><tr><th>ID</th><th>Spiel</th><th>Schiedsrichter</th><th>Status</th><th>Betrag</th><th>Auszahlung</th></tr></thead>
              <tbody>
                ${payoutChains
                  .map(
                    ({ g, ch }) => `
                  <tr>
                    <td class="cell-main"><strong>${esc(g.title)} (Slot ${ch.slot_number})</strong> <span class="badge badge-gray">${esc(ch.ref_code || "–")}</span></td>
                    <td data-label="Schiedsrichter">${esc(fullName(ch.currentAssignee))}</td>
                    <td data-label="Status">${statusBadge(ch.status)}</td>
                    <td data-label="Betrag"><strong>${formatEuro(ch.payout_pool_cents)}</strong></td>
                    <td data-label="Auszahlung">
                      ${
                        ch.payout_settled
                          ? `<span class="badge badge-green">Ausgezahlt</span>`
                          : isKassenwart && ch.status === "CONFIRMED_DEPLOYED"
                          ? `<button class="btn btn-primary btn-sm" onclick="settlePayout(${ch.id})">Auszahlen</button>`
                          : `<span class="badge badge-gray">Offen (nach Einsatz)</span>`
                      }
                    </td>
                  </tr>`
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
    if (state.chainFilterStatus === "active") {
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
        const label =
          ev.event_type === "REPORTED_DEPLOYED"
            ? "Einsatz gemeldet"
            : ev.event_type === "CONFIRMED_DEPLOYED"
            ? "Einsatz bestätigt"
            : "Topf ausgezahlt";
        milestones.push({ label, at: ev.created_at, user: ev.fromUser || ev.toUser });
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
            <div style="color:var(--muted);font-size:0.72rem">${formatDate(ev.created_at)}</div>
          </div>
        `);
        continue;
      }

      if (ev.event_type === "VOLUNTEER_REQUEST") {
        parts.push(`
          <div class="chain-edge">
            <div class="chain-edge-head">
              <span class="chain-edge-arrow-h">&rarr;</span>
              <span class="chain-edge-arrow-v">&darr;</span>
              <span>Übernahme-Anfrage</span>
            </div>
            <div>${ev.fromUser ? esc(fullName(ev.fromUser)) : "–"} möchte übernehmen</div>
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
        <button class="filter-pill ${state.chainFilterStatus === "active" ? "active" : ""}" onclick="setChainFilter('active')">Laufend / Offen</button>
        <button class="filter-pill ${state.chainFilterStatus === "deployed" ? "active" : ""}" onclick="setChainFilter('deployed')">Eingesetzt</button>
        <button class="filter-pill ${state.chainFilterStatus === "open_payment" ? "active" : ""}" onclick="setChainFilter('open_payment')">Offene Zahlungen</button>
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
                      ${ch.payout_pool_cents > 0 ? `<span class="badge badge-amber">Schiri-Topf: ${formatEuro(ch.payout_pool_cents)}${ch.payout_settled ? " (Ausgezahlt)" : ""}</span>` : ""}
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
            <div class="form-group">
              <label>Öffentlicher Hinweis (optional, Pflicht bei &lt; 48h)</label>
              <input type="text" id="hf-note" placeholder="z. B. Beruflich verhindert / Zugausfall" />
            </div>
            <div class="form-group" id="hf-hardship-wrap" style="display:none">
              <label>Vertrauliche Begründung für den Kassenwart (§ 8 Abs. 2 &amp; 4)</label>
              <textarea id="hf-hardship" rows="3" placeholder="Nur für den Mannschaftskassenwart sichtbar..."></textarea>
            </div>
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">An nächste freie Person weitergeben</button>
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
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">Spiel speichern &amp; Schiedsrichter ansetzen</button>
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
                <option value="CONFIRMED">Bestätigt</option>
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
          ${
            state.data.games.length === 0
              ? `<div class="form-group">
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
              <input type="password" id="ep-pass" placeholder="Nur ausfüllen zum Zurücksetzen" />
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
            <div class="form-group">
              <label>Neues Passwort (optional, leer lassen = unverändert)</label>
              <input type="password" id="prof-pass" placeholder="Neues Passwort eingeben" />
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

  const pendingCount = state.data.games.reduce(
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
  );

  const showAdminTabs = canViewAdminTabs(state.user);
  const isWartOrAdmin =
    state.user.role === "SCHIEDSRICHTERWART" || state.user.role === "ADMIN";
  const currentSeason =
    state.data?.season ||
    (state.data?.seasons ? state.data.seasons.find((s) => s.id === state.selectedSeasonId) : null) ||
    state.data?.seasons?.[0];
  const seasonsList = state.data?.seasons || (currentSeason ? [currentSeason] : []);
  const seasonOpts = seasonsList
    .map(
      (s) =>
        `<option value="${s.id}" ${s.id === currentSeason?.id ? "selected" : ""}>${esc(s.name)}${s.is_active ? " (Aktiv)" : ""}</option>`
    )
    .join("");
  if (!showAdminTabs && !["games", "calendar", "tasks"].includes(state.tab)) {
    state.tab = "games";
  }

  let tabContent = "";
  if (state.tab === "games") tabContent = renderGamesTab();
  else if (state.tab === "calendar") tabContent = renderCalendarTab();
  else if (state.tab === "tasks") tabContent = renderTasksTab();
  else if (state.tab === "chains" && showAdminTabs) tabContent = renderChainsTab();
  else if (state.tab === "players" && showAdminTabs) tabContent = renderPlayersTab();
  else if (state.tab === "treasury" && showAdminTabs) tabContent = renderTreasuryTab();
  else if (state.tab === "docs" && showAdminTabs) tabContent = renderDocsTab();

  root.innerHTML = `
    ${renderInstallBannerHtml()}
    <header class="topbar">
      <div class="brand">
        <div class="brand-crest">${RHTC_CREST_SVG}</div>
        <div>
          <h1>RHTC II – Schiedsrichterverwaltung</h1>
          <span>${esc(currentSeason?.name || "Saison")} &bull; Schwarz-Gold</span>
        </div>
      </div>
      <div class="user-bar" style="flex-wrap:wrap">
        <select onchange="changeSeason(this.value)" style="padding:5px 8px;border-radius:6px;border:1px solid rgba(212,160,23,0.55);background:#1e1e1e;color:#fff;font-size:0.82rem">
          ${seasonOpts}
        </select>
        ${isWartOrAdmin ? `<button class="btn btn-outline btn-sm" onclick="openAddSeasonModal()">+ Saison</button>` : ""}
        ${isWartOrAdmin && currentSeason ? `<button class="btn btn-outline btn-sm" onclick="openEditSeasonModal()">Umbenennen</button>` : ""}
        ${isWartOrAdmin && currentSeason && seasonsList.length > 1 ? `<button class="btn btn-outline btn-sm" style="color:var(--danger);border-color:rgba(239,68,68,0.5)" onclick="deleteSeason(${currentSeason.id}, '${esc(currentSeason.name)}')">Löschen</button>` : ""}
        ${isWartOrAdmin && currentSeason && !currentSeason.is_active ? `<button class="btn btn-warn btn-sm" onclick="activateSeason(${currentSeason.id})">Aktiv setzen</button>` : ""}
        <span><strong>${esc(fullName(state.user))}</strong> (${roleLabel(state.user.role)})</span>
        <button class="btn btn-outline btn-sm" onclick="openProfileModal()">Mein Profil</button>
        <button class="btn btn-outline btn-sm" onclick="logout()">Abmelden</button>
      </div>
    </header>
    <div class="container">
      ${state.error ? `<div class="alert alert-danger">${esc(state.error)}</div>` : ""}
      <div class="tabs">
        <button class="tab-btn ${state.tab === "games" ? "active" : ""}" onclick="setTab('games')">Spielplan &amp; Ansetzungen</button>
        <button class="tab-btn ${state.tab === "calendar" ? "active" : ""}" onclick="setTab('calendar')">Kalender</button>
        <button class="tab-btn ${state.tab === "tasks" ? "active" : ""}" onclick="setTab('tasks')">Meine Aufgaben ${pendingCount > 0 ? `<span class="badge badge-red">${pendingCount}</span>` : ""}</button>
        ${
          showAdminTabs
            ? `
              <button class="tab-btn ${state.tab === "chains" ? "active" : ""}" onclick="setTab('chains')">Weitergabeketten</button>
              <button class="tab-btn ${state.tab === "players" ? "active" : ""}" onclick="setTab('players')">Schiedsrichterliste (§ 2)</button>
              <button class="tab-btn ${state.tab === "treasury" ? "active" : ""}" onclick="setTab('treasury')">Kasse &amp; Härtefälle</button>
              <button class="tab-btn ${state.tab === "docs" ? "active" : ""}" onclick="setTab('docs')">Dokumentation (§ 6)</button>
            `
            : ""
        }
      </div>
      ${tabContent}
    </div>
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
        const res = await api(`/api/chains/${chainId}/handoff`, {
          method: "POST",
          body: JSON.stringify({
            reasonType: document.getElementById("hf-reason").value,
            publicNote: document.getElementById("hf-note").value,
            hardshipReasonConfidential:
              document.getElementById("hf-hardship")?.value || "",
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
        await api("/api/games", {
          method: "POST",
          body: JSON.stringify({
            seasonId: state.data.season?.id,
            title: document.getElementById("gm-title").value,
            location: document.getElementById("gm-loc").value,
            kickoffAt: new Date(document.getElementById("gm-kickoff").value).toISOString(),
            isFirstGameOfSeason: document.getElementById("gm-first").checked,
            randomDraw: document.getElementById("gm-random").checked,
            ref1Id: document.getElementById("gm-r1").value || null,
            ref2Id: document.getElementById("gm-r2").value || null,
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
}

window.setTab = (t) => {
  state.tab = t;
  state.error = null;
  render();
};

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
  state.selectedSeasonId = Number(seasonId);
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
    const due = ev.fee_total_cents - ev.waived_amount_cents;
    return [
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
    const randomEl = document.getElementById("ig-random");
    const seasonId =
      state.data?.season?.id ||
      state.selectedSeasonId ||
      state.data?.seasons?.[0]?.id;
    const res = await api("/api/games/import", {
      method: "POST",
      body: JSON.stringify({
        seasonId,
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

window.copyChatMsg = () => {
  const text = document.getElementById("chat-msg-box").innerText;
  navigator.clipboard.writeText(text);
  alert("Text für den Gruppenchat kopiert!");
};

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

loadDashboard();
