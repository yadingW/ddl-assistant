(function () {
  "use strict";

  const NOTE_PREFIX = "workspace_note_";
  const EXTRACTED_PREFIX = "workspace_extracted_";
  const LONG_TERM_NOTE_KEY = "workspace_long_term_note";
  const LONG_TERM_EXTRACTED_KEY = `${EXTRACTED_PREFIX}long_term`;
  const TASK_STATE_KEY = "workspace_task_states";
  const PARSER_VERSION_KEY = "workspace_parser_version";
  const PARSER_VERSION = "9";
  const LEGACY_TASK_KEY = "ddl-assistant.tasks.v1";
  const EXTRACT_DELAY = 320;

  const noteInput = document.getElementById("workspaceNote");
  const longTermInput = document.getElementById("longTermNote");
  const saveStatus = document.getElementById("saveStatus");
  const previousWeekBtn = document.getElementById("previousWeekBtn");
  const closeDrawerBtn = document.getElementById("closeDrawerBtn");
  const drawer = document.getElementById("previousWeekDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const previousWeekContent = document.getElementById("previousWeekContent");
  const previousWeekLabel = document.getElementById("previousWeekLabel");
  const archiveDrawer = document.getElementById("archiveDrawer");
  const archiveDrawerList = document.getElementById("archiveDrawerList");
  const archiveSummary = document.getElementById("archiveSummary");
  const closeArchiveBtn = document.getElementById("closeArchiveBtn");
  const exportBackupBtn = document.getElementById("exportBackupBtn");
  const importBackupBtn = document.getElementById("importBackupBtn");
  const enableReminderBtn = document.getElementById("enableReminderBtn");
  const copyFollowUpsBtn = document.getElementById("copyFollowUpsBtn");
  const backupFileInput = document.getElementById("backupFileInput");

  const lists = {
    today: document.getElementById("todayList"),
    week: document.getElementById("weekList"),
    future: document.getElementById("futureList")
  };

  const counts = {
    total: document.getElementById("ddlCount"),
    today: document.getElementById("todayCount"),
    week: document.getElementById("weekCount"),
    future: document.getElementById("futureCount")
  };
  const archiveView = createArchiveView();
  let archiveItems = [];

  const now = new Date();
  const currentWeek = getIsoWeekInfo(now);
  const previousWeek = getIsoWeekInfo(addDays(startOfIsoWeek(now), -7));
  const currentNoteKey = `${NOTE_PREFIX}${currentWeek.id}`;
  const currentExtractedKey = `${EXTRACTED_PREFIX}${currentWeek.id}`;
  let extractTimer = null;
  let historySaveTimer = null;
  let reminderTimer = null;
  let taskStates = loadJson(TASK_STATE_KEY, {});
  const notifiedReminders = new Set();
  const composingInputs = new Set();

  initialize();

  function initialize() {
    migrateLegacyTasks();
    noteInput.value = window.localStorage.getItem(currentNoteKey) || "";
    longTermInput.value = window.localStorage.getItem(LONG_TERM_NOTE_KEY) || "";

    document.getElementById("todayText").textContent = formatFullDate(now);
    document.getElementById("weekLabel").textContent =
      `${formatShortDate(currentWeek.start)} - ${formatShortDate(currentWeek.end)}`;

    anchorRelativeDates(noteInput, currentNoteKey, startOfToday());
    anchorRelativeDates(longTermInput, LONG_TERM_NOTE_KEY, startOfToday());
    rebuildExtractionCaches();

    bindEvents();
    renderAllReminders();
    registerServiceWorker();
    updateReminderButton();
    startReminderLoop();
  }

  function bindEvents() {
    bindWorkspaceInput(noteInput, handleNoteInput);
    bindWorkspaceInput(longTermInput, handleLongTermInput);
    previousWeekContent.addEventListener("input", savePreviousWeekNote);
    previousWeekContent.addEventListener("blur", savePreviousWeekNote);
    previousWeekBtn.addEventListener("click", () => openPreviousWeekDrawer());
    closeDrawerBtn.addEventListener("click", closePreviousWeekDrawer);
    closeArchiveBtn.addEventListener("click", closeArchiveDrawer);
    drawerBackdrop.addEventListener("click", closeOpenDrawer);
    exportBackupBtn.addEventListener("click", exportBackup);
    importBackupBtn.addEventListener("click", () => backupFileInput.click());
    enableReminderBtn.addEventListener("click", requestReminderPermission);
    copyFollowUpsBtn.addEventListener("click", copyTodayFollowUps);
    backupFileInput.addEventListener("change", importBackup);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeOpenDrawer();
      }
    });
  }

  function bindWorkspaceInput(textarea, handler) {
    textarea.addEventListener("compositionstart", () => {
      composingInputs.add(textarea);
    });
    textarea.addEventListener("compositionend", () => {
      composingInputs.delete(textarea);
      handler();
    });
    textarea.addEventListener("input", (event) => {
      handler(event);
    });
  }

  function handleNoteInput(event) {
    window.localStorage.setItem(currentNoteKey, noteInput.value);
    if (!event || !event.isComposing) scheduleExtraction();
  }

  function handleLongTermInput(event) {
    window.localStorage.setItem(LONG_TERM_NOTE_KEY, longTermInput.value);
    if (!event || !event.isComposing) scheduleExtraction();
  }

  function scheduleExtraction() {
    showSaveStatus("已保存");
    window.clearTimeout(extractTimer);
    extractTimer = window.setTimeout(() => {
      if (composingInputs.size) return;
      anchorRelativeDates(noteInput, currentNoteKey, startOfToday());
      anchorRelativeDates(longTermInput, LONG_TERM_NOTE_KEY, startOfToday());
      updateCurrentWeekExtraction();
      updateLongTermExtraction();
      renderAllReminders();
    }, EXTRACT_DELAY);
  }

  function anchorRelativeDates(textarea, storageKey, referenceDate) {
    const original = textarea.value;
    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const tokenPattern =
      /(?:下周[一二三四五六日天]|本周[一二三四五六日天]|这周[一二三四五六日天]|周[一二三四五六日天]|大后天|后天|明天|今天|今日|当天|本日)/g;
    const replacements = [];

    const anchored = original.replace(tokenPattern, (token, offset) => {
      const parsed = parseDateExpression(token, referenceDate);
      if (!parsed) return token;

      const nextChar = original[offset + token.length] || "";
      const prevChar = original[offset - 1] || "";
      let replacement = formatAnchorDate(parsed.date);
      if (/\d/.test(nextChar)) replacement += " ";
      if (/\d/.test(prevChar)) replacement = ` ${replacement}`;
      replacements.push({
        start: offset,
        end: offset + token.length,
        replacementLength: replacement.length
      });
      return replacement;
    }).replace(/(\d{1,2}\.\d{1,2})(?=\d{1,2}(?:点|:))/g, "$1 ");

    if (anchored === original) return;

    textarea.value = anchored;
    textarea.setSelectionRange(
      mapSelectionPosition(selectionStart, replacements),
      mapSelectionPosition(selectionEnd, replacements)
    );
    window.localStorage.setItem(storageKey, anchored);
  }

  function mapSelectionPosition(position, replacements) {
    let delta = 0;

    for (const replacement of replacements) {
      const originalLength = replacement.end - replacement.start;
      const replacementDelta = replacement.replacementLength - originalLength;

      if (position < replacement.start) break;
      if (position <= replacement.end) {
        return Math.max(0, replacement.start + delta + replacement.replacementLength);
      }

      delta += replacementDelta;
    }

    return Math.max(0, position + delta);
  }

  function updateCurrentWeekExtraction() {
    const items = extractDdlItems(noteInput.value, {
      sourceId: currentWeek.id,
      sourceType: "weekly",
      referenceDate: startOfToday()
    });
    window.localStorage.setItem(currentExtractedKey, JSON.stringify(items));
  }

  function updateWeeklyExtraction(weekId, text) {
    const referenceDate = getIsoWeekStartFromId(weekId) || startOfToday();
    const items = extractDdlItems(text, {
      sourceId: weekId,
      sourceType: "weekly",
      referenceDate
    });

    window.localStorage.setItem(
      `${EXTRACTED_PREFIX}${weekId}`,
      JSON.stringify(items)
    );
  }

  function updateLongTermExtraction() {
    const items = extractDdlItems(longTermInput.value, {
      sourceId: "long_term",
      sourceType: "long-term",
      referenceDate: startOfToday()
    });
    window.localStorage.setItem(LONG_TERM_EXTRACTED_KEY, JSON.stringify(items));
  }

  function rebuildExtractionCaches() {
    const noteEntries = [];
    const extractedKeys = [];

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key) continue;

      if (key.startsWith(NOTE_PREFIX)) {
        noteEntries.push([key, window.localStorage.getItem(key) || ""]);
      } else if (key.startsWith(EXTRACTED_PREFIX)) {
        extractedKeys.push(key);
      }
    }

    extractedKeys.forEach((key) => window.localStorage.removeItem(key));

    noteEntries.forEach(([key, text]) => {
      const sourceId = key.slice(NOTE_PREFIX.length);
      const referenceDate =
        sourceId === currentWeek.id
          ? startOfToday()
          : getIsoWeekStartFromId(sourceId) || startOfToday();
      const items = extractDdlItems(text, {
        sourceId,
        sourceType: "weekly",
        referenceDate
      });

      window.localStorage.setItem(
        `${EXTRACTED_PREFIX}${sourceId}`,
        JSON.stringify(items)
      );
    });

    updateLongTermExtraction();
    window.localStorage.setItem(PARSER_VERSION_KEY, PARSER_VERSION);
  }

  function extractDdlItems(text, options) {
    const { sourceId, sourceType, referenceDate } = options;
    const items = [];
    let currentContext = "";
    let activeDate = null;

    text.split(/\r?\n/).forEach((rawLine, lineIndex) => {
      const line = rawLine.trim();

      if (!line) {
        currentContext = "";
        activeDate = null;
        return;
      }

      const taskText = getTaskText(line);
      const dateResult = parseDateExpression(taskText, referenceDate);

      if (!dateResult && /[:：]\s*$/.test(taskText)) {
        currentContext = normalizePrefix(taskText);
        activeDate = null;
        return;
      }

      const followUp = parseFollowUpLine(taskText, referenceDate);
      if (followUp) {
        addExtractedItem({
          items,
          sourceId,
          sourceType,
          sourceLine: line,
          lineIndex,
          currentPrefix: currentContext,
          title: followUp.title,
          dateResult: followUp.dateResult,
          type: "followUp",
          waitingOn: followUp.waitingOn
        });
        return;
      }

      if (dateResult) {
        const titleWithoutDate = cleanTaskTitle(
          removeMatchedTime(removeMatchedDate(taskText, dateResult), dateResult)
        );

        if (!titleWithoutDate) {
          activeDate = dateResult;
          return;
        }

        activeDate = dateResult;
        addExtractedItem({
          items,
          sourceId,
          sourceType,
          sourceLine: line,
          lineIndex,
          currentPrefix: currentContext,
          title: titleWithoutDate,
          dateResult
        });
        return;
      }

      if (!activeDate) return;

      const inheritedDateResult = createInheritedDateResult(activeDate, taskText);
      const inheritedTitle = cleanTaskTitle(
        removeMatchedTime(taskText, inheritedDateResult)
      );
      if (!inheritedTitle) return;

      addExtractedItem({
        items,
        sourceId,
        sourceType,
        sourceLine: line,
        lineIndex,
        currentPrefix: currentContext,
        title: inheritedTitle,
        dateResult: inheritedDateResult
      });
    });

    return items;
  }

  function addExtractedItem(options) {
    const {
      items,
      sourceId,
      sourceType,
      sourceLine,
      lineIndex,
      currentPrefix,
      title,
      dateResult,
      type = "task",
      waitingOn = ""
    } = options;
    const displayTitle = currentPrefix
      ? `[${currentPrefix}] ${title}`
      : title;
    const id = createStableId(
      `${sourceId}|${currentPrefix}|${sourceLine}|${dateResult.dateKey}`
    );

    items.push({
      id,
      title: displayTitle,
      sourceLine,
      lineIndex,
      type,
      waitingOn,
      contextPrefix: currentPrefix,
      dueDate: dateResult.dateKey,
      dueTime: dateResult.dueTime || null,
      dueAt: dateResult.dueAt || null,
      followUpDate: type === "followUp" ? dateResult.dateKey : null,
      followUpTime: type === "followUp" ? dateResult.dueTime || null : null,
      followUpAt: type === "followUp" ? dateResult.dueAt || null : null,
      dateLabel: dateResult.label,
      sourceId,
      sourceType,
      sourceWeek: sourceType === "weekly" ? sourceId : null
    });
  }

  function parseFollowUpLine(text, referenceDate) {
    if (!/^>\s*/.test(text)) return null;

    const body = text.replace(/^>\s*/, "").trim();
    const dateResult = parseDateExpression(body, referenceDate);
    if (!dateResult || !Number.isInteger(dateResult.matchIndex)) return null;

    const waitingOn = cleanTaskTitle(body.slice(0, dateResult.matchIndex));
    if (!waitingOn) return null;

    const titleSource = body.slice(dateResult.matchIndex);
    const title = cleanTaskTitle(
      removeMatchedTime(removeMatchedDate(titleSource, {
        ...dateResult,
        matchIndex: 0
      }), dateResult)
    );

    return {
      waitingOn,
      title: title || "催办",
      dateResult
    };
  }

  function parseDateExpression(text, referenceDate) {
    const explicitParsers = [
      {
        pattern: /(20\d{2}|19\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/,
        create(match) {
          return createValidDate(Number(match[1]), Number(match[2]), Number(match[3]));
        }
      },
      {
        pattern: /\b(\d{1,2})[./-](\d{1,2})\b/,
        create(match) {
          return createDateWithSmartYear(
            referenceDate,
            Number(match[1]),
            Number(match[2])
          );
        }
      },
      {
        pattern: /(\d{1,2})月(\d{1,2})日?/,
        create(match) {
          return createDateWithSmartYear(
            referenceDate,
            Number(match[1]),
            Number(match[2])
          );
        }
      }
    ];

    for (const parser of explicitParsers) {
      const match = text.match(parser.pattern);
      if (!match) continue;

      const date = parser.create(match);
      if (date) {
        return createDateResult(date, match[0].trim(), match[0].trim(), match.index, text);
      }
    }

    const relativeRules = [
      { pattern: /大后天/, days: 3 },
      { pattern: /后天/, days: 2 },
      { pattern: /明天/, days: 1 },
      { pattern: /今天|今日|当天|本日/, days: 0 }
    ];

    for (const rule of relativeRules) {
      const match = text.match(rule.pattern);
      if (match) {
        const date = addDays(startOfDay(referenceDate), rule.days);
        return createDateResult(date, match[0], match[0], match.index, text);
      }
    }

    const weekMatch = text.match(/(下周|本周|这周|周)([一二三四五六日天])/);
    if (weekMatch) {
      const targetDay = chineseWeekdayToNumber(weekMatch[2]);
      const weekOffset = weekMatch[1] === "下周" ? 7 : 0;
      const date = addDays(
        startOfIsoWeek(referenceDate),
        targetDay - 1 + weekOffset
      );

      return createDateResult(date, weekMatch[0], weekMatch[0], weekMatch.index, text);
    }

    return null;
  }

  function createDateResult(date, label, matchedText, matchIndex, sourceText) {
    const dateKey = toDateKey(date);
    const timeResult = parseTimeExpression(sourceText);
    const dueTime = timeResult ? timeResult.value : null;

    return {
      date,
      dateKey,
      label,
      matchedText,
      matchIndex,
      dueTime,
      dueAt: dueTime ? `${dateKey}T${dueTime}:00` : null,
      timeMatchedText: timeResult ? timeResult.matchedText : null,
      timeMatchIndex: timeResult ? timeResult.matchIndex : null
    };
  }

  function createInheritedDateResult(activeDate, sourceText) {
    const timeResult = parseTimeExpression(sourceText);
    if (!timeResult) return activeDate;

    return {
      ...activeDate,
      dueTime: timeResult.value,
      dueAt: `${activeDate.dateKey}T${timeResult.value}:00`,
      timeMatchedText: timeResult.matchedText,
      timeMatchIndex: timeResult.matchIndex
    };
  }

  function parseTimeExpression(text) {
    const timePattern = /(上午|早上|下午|晚上|今晚|中午)?\s*(\d{1,2})(?::(\d{2})|点(?:半|(\d{1,2})分?)?)/g;
    let match;

    while ((match = timePattern.exec(text))) {
      let hour = Number(match[2]);
      let minute = match[3] ? Number(match[3]) : 0;
      const period = match[1] || "";

      if (match[0].includes("半")) {
        minute = 30;
      } else if (match[4]) {
        minute = Number(match[4]);
      }

      if (hour > 23 || minute > 59) continue;
      if ((period === "下午" || period === "晚上" || period === "今晚") && hour < 12) {
        hour += 12;
      }
      if ((period === "上午" || period === "早上") && hour === 12) {
        hour = 0;
      }
      if (period === "中午" && hour < 11) {
        hour += 12;
      }

      return {
        value: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        matchedText: match[0].trim(),
        matchIndex: match.index
      };
    }

    return null;
  }

  function renderAllReminders() {
    const allItems = loadAllExtractedItems();
    const grouped = { today: [], week: [], future: [], archive: [] };

    allItems
      .sort((a, b) => {
        return compareReminderItems(a, b);
      })
      .forEach((item) => {
        grouped[getDateGroup(item)].push(item);
      });

    ["today", "week", "future"].forEach((groupName) => {
      renderGroup(groupName, grouped[groupName]);
      counts[groupName].textContent = String(grouped[groupName].length);
    });
    renderArchiveGroup(grouped.archive);

    counts.total.textContent = String(
      grouped.today.length + grouped.week.length + grouped.future.length
    );
    checkDueReminders();
  }

  function loadAllExtractedItems() {
    const itemMap = new Map();

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key || !key.startsWith(EXTRACTED_PREFIX)) continue;

      const storedItems = loadJson(key, []);
      if (!Array.isArray(storedItems)) continue;

      storedItems.forEach((item) => {
        if (isReminderItem(item)) {
          itemMap.set(item.id, item);
        }
      });
    }

    return Array.from(itemMap.values());
  }

  function renderGroup(groupName, items) {
    const list = lists[groupName];
    list.replaceChildren();

    if (groupName === "today") {
      renderTodayGroup(list, items);
      return;
    }

    if (!items.length) {
      list.appendChild(document.getElementById("emptyTemplate").content.cloneNode(true));
      return;
    }

    items.forEach((item) => {
      list.appendChild(createReminderElement(item));
    });
  }

  function renderTodayGroup(list, items) {
    const tasks = items.filter((item) => !isFollowUp(item));
    const followUps = items.filter(isFollowUp);

    if (!tasks.length && !followUps.length) {
      list.appendChild(document.getElementById("emptyTemplate").content.cloneNode(true));
      return;
    }

    const taskBlock = createTodayBlock("今日要做");
    if (tasks.length) {
      tasks.forEach((item) => taskBlock.appendChild(createReminderElement(item)));
    } else {
      taskBlock.appendChild(createInlineEmpty("暂无要做"));
    }
    list.appendChild(taskBlock);

    const followUpBlock = createTodayBlock("今日待催");
    if (followUps.length) {
      const grouped = groupByWaitingOn(followUps);
      Object.keys(grouped).forEach((waitingOn) => {
        const heading = document.createElement("div");
        heading.className = "followup-person";
        heading.textContent = waitingOn;
        followUpBlock.appendChild(heading);
        grouped[waitingOn].forEach((item) => {
          followUpBlock.appendChild(createReminderElement(item));
        });
      });
    } else {
      followUpBlock.appendChild(createInlineEmpty("暂无待催"));
    }
    list.appendChild(followUpBlock);
  }

  function createTodayBlock(title) {
    const block = document.createElement("section");
    const heading = document.createElement("div");
    block.className = "today-block";
    heading.className = "today-subheading";
    heading.textContent = title;
    block.appendChild(heading);
    return block;
  }

  function createInlineEmpty(text) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = text;
    return empty;
  }

  function groupByWaitingOn(items) {
    return items.reduce((result, item) => {
      const key = item.waitingOn || "未指定对象";
      if (!result[key]) result[key] = [];
      result[key].push(item);
      return result;
    }, {});
  }

  function createArchiveView() {
    const sidebar = document.querySelector(".ddl-sidebar");
    const wrapper = document.createElement("section");
    const button = document.createElement("button");
    const list = document.createElement("div");

    wrapper.className = "archive-panel";
    button.className = "archive-toggle";
    button.type = "button";
    button.addEventListener("click", openArchiveDrawer);
    wrapper.append(button);
    sidebar.appendChild(wrapper);

    return { wrapper, button };
  }

  function renderArchiveGroup(items) {
    archiveItems = items;
    archiveView.button.textContent = `查看历史已完成 (${items.length})`;
    archiveView.button.disabled = items.length === 0;
    archiveView.wrapper.classList.toggle("has-items", items.length > 0);
    if (archiveDrawer.classList.contains("open")) {
      renderArchiveDrawer();
    }
  }

  function createReminderElement(item) {
    const fragment = document.getElementById("ddlItemTemplate").content.cloneNode(true);
    const label = fragment.querySelector(".ddl-item");
    const checkbox = fragment.querySelector(".ddl-checkbox");
    const content = fragment.querySelector(".ddl-content");
    const title = fragment.querySelector(".ddl-title");
    const date = fragment.querySelector(".ddl-date");
    const status = fragment.querySelector(".ddl-status");
    const state = taskStates[item.id] || { done: false };

    checkbox.checked = Boolean(state.done);
    title.textContent = normalizeReminderTitle(item);
    date.textContent = formatReminderDate(item);
    date.dateTime = getItemAt(item) || getItemDateKey(item);

    const dueDate = fromDateKey(getItemDateKey(item));
    if (state.done && state.completedAt) {
      status.textContent = formatCompletedAt(state.completedAt);
    } else if (dueDate < startOfToday() && !state.done) {
      status.textContent = "· 已逾期";
      status.classList.add("overdue");
    }

    label.classList.toggle("done", Boolean(state.done));
    checkbox.addEventListener("change", () => {
      const timestamp = new Date().toISOString();
      taskStates[item.id] = {
        done: checkbox.checked,
        updatedAt: timestamp,
        completedAt: checkbox.checked ? timestamp : null
      };
      window.localStorage.setItem(TASK_STATE_KEY, JSON.stringify(taskStates));
      renderAllReminders();
    });

    content.setAttribute("role", "button");
    content.tabIndex = 0;
    content.title = "定位到原文";
    content.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      locateReminderSource(item);
    });
    content.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      locateReminderSource(item);
    });

    return fragment;
  }

  function locateReminderSource(item) {
    let target = null;

    if (item.sourceType === "long-term" || item.sourceId === "long_term") {
      const panel = document.querySelector(".long-term-panel");
      panel.open = true;
      target = longTermInput;
    } else if (item.sourceId === currentWeek.id) {
      target = noteInput;
    } else if (item.sourceId === previousWeek.id) {
      openPreviousWeekDrawer(false);
      target = previousWeekContent;
    }

    if (!target) return;

    window.requestAnimationFrame(() => {
      const range = findSourceLineRange(target.value, item);
      target.focus();
      target.setSelectionRange(range.end, range.end);
      scrollTextareaToLine(target, range.lineIndex);
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function findSourceLineRange(text, item) {
    const lines = text.split(/\r?\n/);
    let lineIndex = Number.isInteger(item.lineIndex) ? item.lineIndex : -1;

    if (
      lineIndex < 0 ||
      lineIndex >= lines.length ||
      lines[lineIndex].trim() !== String(item.sourceLine || "").trim()
    ) {
      lineIndex = lines.findIndex(
        (line) => line.trim() === String(item.sourceLine || "").trim()
      );
    }

    if (lineIndex < 0) {
      const fallback = normalizeReminderTitle(item);
      lineIndex = lines.findIndex((line) => line.includes(fallback));
    }

    lineIndex = Math.max(0, lineIndex);
    let start = 0;
    for (let index = 0; index < lineIndex; index += 1) {
      start += lines[index].length + 1;
    }

    return {
      lineIndex,
      start,
      end: start + (lines[lineIndex] || "").length
    };
  }

  function scrollTextareaToLine(textarea, lineIndex) {
    const lineHeight = Number.parseFloat(
      window.getComputedStyle(textarea).lineHeight
    ) || 24;
    textarea.scrollTop = Math.max(
      0,
      lineIndex * lineHeight - textarea.clientHeight / 2
    );
  }

  function getDateGroup(item) {
    const today = startOfToday();
    const dueDate = fromDateKey(getItemDateKey(item));
    const state = taskStates[item.id] || {};
    const done = Boolean(state.done);

    if (done) {
      const completedDate = state.completedAt ? startOfDay(new Date(state.completedAt)) : null;
      if (completedDate && !Number.isNaN(completedDate.getTime())) {
        if (completedDate < today) return "archive";
      } else if (dueDate < today) {
        return "archive";
      }
    }

    if (dueDate <= today) return "today";
    if (dueDate <= endOfIsoWeek(today)) return "week";
    return "future";
  }

  function isFollowUp(item) {
    return item && item.type === "followUp";
  }

  function getItemDateKey(item) {
    return isFollowUp(item) && item.followUpDate ? item.followUpDate : item.dueDate;
  }

  function getItemTime(item) {
    return isFollowUp(item) ? item.followUpTime || null : item.dueTime || null;
  }

  function getItemAt(item) {
    return isFollowUp(item) ? item.followUpAt || item.dueAt || null : item.dueAt || null;
  }

  function compareReminderItems(a, b) {
    const groupA = getDateGroup(a);
    const groupB = getDateGroup(b);

    if (groupA === groupB) {
      const doneA = Boolean(taskStates[a.id] && taskStates[a.id].done);
      const doneB = Boolean(taskStates[b.id] && taskStates[b.id].done);
      if (doneA !== doneB) return doneA ? 1 : -1;
    }

    const dateOrder = getSortTime(a) - getSortTime(b);
    return dateOrder || a.title.localeCompare(b.title, "zh-CN");
  }

  function openPreviousWeekDrawer(focusCloseButton = true) {
    closeArchiveDrawer(false);
    const note = window.localStorage.getItem(`${NOTE_PREFIX}${previousWeek.id}`) || "";
    previousWeekLabel.textContent =
      `${formatShortDate(previousWeek.start)} - ${formatShortDate(previousWeek.end)}`;
    previousWeekContent.value = note;
    previousWeekContent.placeholder = "上周没有随记。";
    drawerBackdrop.hidden = false;
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    if (focusCloseButton) {
      closeDrawerBtn.focus();
    }
  }

  function openArchiveDrawer() {
    if (!archiveItems.length) return;

    closePreviousWeekDrawer(false);
    renderArchiveDrawer();
    drawerBackdrop.hidden = false;
    archiveDrawer.classList.add("open");
    archiveDrawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawer-open");
    closeArchiveBtn.focus();
  }

  function renderArchiveDrawer() {
    archiveSummary.textContent = `早于今天且已完成 · ${archiveItems.length} 条`;
    archiveDrawerList.replaceChildren();

    if (!archiveItems.length) {
      archiveDrawerList.appendChild(
        document.getElementById("emptyTemplate").content.cloneNode(true)
      );
      return;
    }

    const grouped = groupArchiveItems(archiveItems);
    ["本周", "上周", "更早周次"].forEach((label) => {
      if (!grouped[label].length) return;
      const heading = document.createElement("div");
      heading.className = "today-subheading";
      heading.textContent = label;
      archiveDrawerList.appendChild(heading);
      grouped[label].forEach((item) => {
        archiveDrawerList.appendChild(createReminderElement(item));
      });
    });
  }

  function groupArchiveItems(items) {
    const result = {
      本周: [],
      上周: [],
      更早周次: []
    };
    const thisWeekStart = startOfIsoWeek(startOfToday());
    const lastWeekStart = addDays(thisWeekStart, -7);

    items.forEach((item) => {
      const date = getArchiveReferenceDate(item);
      if (date >= thisWeekStart) {
        result["本周"].push(item);
      } else if (date >= lastWeekStart) {
        result["上周"].push(item);
      } else {
        result["更早周次"].push(item);
      }
    });

    return result;
  }

  function getArchiveReferenceDate(item) {
    const state = taskStates[item.id] || {};
    const completed = state.completedAt ? new Date(state.completedAt) : null;
    if (completed && !Number.isNaN(completed.getTime())) {
      return startOfDay(completed);
    }

    return fromDateKey(getItemDateKey(item));
  }

  function savePreviousWeekNote(event) {
    const save = () => {
      const key = `${NOTE_PREFIX}${previousWeek.id}`;
      window.localStorage.setItem(key, previousWeekContent.value);
      updateWeeklyExtraction(previousWeek.id, previousWeekContent.value);
      renderAllReminders();
      showSaveStatus("已保存");
    };

    window.clearTimeout(historySaveTimer);
    if (event.type === "blur") {
      save();
      return;
    }

    historySaveTimer = window.setTimeout(save, EXTRACT_DELAY);
  }

  function closePreviousWeekDrawer(restoreFocus = true) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    if (!archiveDrawer.classList.contains("open")) {
      drawerBackdrop.hidden = true;
      document.body.classList.remove("drawer-open");
    }
    if (restoreFocus) {
      previousWeekBtn.focus();
    }
  }

  function closeArchiveDrawer(restoreFocus = true) {
    archiveDrawer.classList.remove("open");
    archiveDrawer.setAttribute("aria-hidden", "true");
    if (!drawer.classList.contains("open")) {
      drawerBackdrop.hidden = true;
      document.body.classList.remove("drawer-open");
    }
    if (restoreFocus) {
      archiveView.button.focus();
    }
  }

  function closeOpenDrawer() {
    if (archiveDrawer.classList.contains("open")) {
      closeArchiveDrawer();
    }
    if (drawer.classList.contains("open")) {
      closePreviousWeekDrawer();
    }
    if (
      !archiveDrawer.classList.contains("open") &&
      !drawer.classList.contains("open")
    ) {
      drawerBackdrop.hidden = true;
      document.body.classList.remove("drawer-open");
    }
  }

  function exportBackup() {
    const backup = {};

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && key.startsWith("workspace_")) {
        backup[key] = window.localStorage.getItem(key);
      }
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `ddl-backup-${formatFileDate(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function importBackup() {
    const [file] = backupFileInput.files;
    if (!file) return;

    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
        throw new Error("invalid backup");
      }

      const entries = Object.entries(parsed).filter(
        ([key, value]) =>
          key.startsWith("workspace_") && typeof value === "string"
      );
      if (!entries.length) {
        throw new Error("empty backup");
      }

      entries.forEach(([key, value]) => {
        window.localStorage.setItem(key, value);
      });

      window.alert("恢复成功，页面将重新加载。");
      window.location.reload();
    } catch {
      window.alert("恢复失败：请选择由本应用导出的 JSON 备份文件。");
      backupFileInput.value = "";
    }
  }

  async function copyTodayFollowUps() {
    const today = startOfToday();
    const followUps = loadAllExtractedItems()
      .filter((item) => {
        const state = taskStates[item.id];
        return (
          isFollowUp(item) &&
          !(state && state.done) &&
          fromDateKey(getItemDateKey(item)) <= today
        );
      })
      .sort(compareReminderItems);

    if (!followUps.length) {
      showInPageReminder("今天没有未处理待催。");
      return;
    }

    const grouped = groupByWaitingOn(followUps);
    const text = Object.keys(grouped)
      .map((waitingOn) => {
        const lines = grouped[waitingOn].map(
          (item) => `- ${normalizeReminderTitle(item)}（${formatReminderDate(item)}）`
        );
        return `${waitingOn}\n${lines.join("\n")}`;
      })
      .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      showInPageReminder("今日待催已复制。");
    } catch {
      fallbackCopyText(text);
      showInPageReminder("今日待催已复制。");
    }
  }

  function fallbackCopyText(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  async function requestReminderPermission() {
    if (!("Notification" in window)) {
      showInPageReminder("当前浏览器不支持系统通知。");
      return;
    }

    const permission = await Notification.requestPermission();
    updateReminderButton();

    if (permission === "granted") {
      showInPageReminder("提醒已开启。应用打开期间会进行到点提醒。");
      checkDueReminders();
    } else {
      showInPageReminder("通知权限未开启。");
    }
  }

  function updateReminderButton() {
    if (!enableReminderBtn) return;

    if (!("Notification" in window)) {
      enableReminderBtn.textContent = "提醒不可用";
      enableReminderBtn.disabled = true;
      return;
    }

    enableReminderBtn.textContent =
      Notification.permission === "granted" ? "提醒已开启" : "开启提醒";
  }

  function startReminderLoop() {
    window.clearInterval(reminderTimer);
    reminderTimer = window.setInterval(checkDueReminders, 30000);
    checkDueReminders();
  }

  function checkDueReminders() {
    const currentTime = Date.now();
    const dueItems = loadAllExtractedItems().filter((item) => {
      const state = taskStates[item.id];
      if (!item.dueAt || (state && state.done)) return false;

      const reminderKey = `${item.id}|${item.dueAt}`;
      if (notifiedReminders.has(reminderKey)) return false;

      return new Date(item.dueAt).getTime() <= currentTime;
    });

    dueItems.forEach((item) => {
      const reminderKey = `${item.id}|${item.dueAt}`;
      notifiedReminders.add(reminderKey);
      notifyReminder(item);
    });
  }

  async function notifyReminder(item) {
    const title = "DDL 到点提醒";
    const body = `${formatReminderDate(item)} ${normalizeReminderTitle(item)}`;

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        const registration = await navigator.serviceWorker.ready;
        if (registration && registration.showNotification) {
          registration.showNotification(title, {
            body,
            tag: item.id,
            renotify: true,
            icon: "icons/icon-192.png"
          });
          return;
        }
      } catch {
        // Fall back to the in-page reminder.
      }

      try {
        new Notification(title, { body, tag: item.id });
        return;
      } catch {
        // Fall back to the in-page reminder.
      }
    }

    showInPageReminder(`${title}：${body}`);
  }

  function showInPageReminder(message) {
    let toast = document.getElementById("reminderToast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "reminderToast";
      toast.className = "reminder-toast";
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(showInPageReminder.timer);
    showInPageReminder.timer = window.setTimeout(() => {
      toast.classList.remove("show");
    }, 4500);
  }

  function showSaveStatus(message) {
    saveStatus.textContent = message;
    saveStatus.style.opacity = "1";
    window.clearTimeout(showSaveStatus.timer);
    showSaveStatus.timer = window.setTimeout(() => {
      saveStatus.style.opacity = "0.65";
    }, 900);
  }

  function migrateLegacyTasks() {
    if (window.localStorage.getItem(currentNoteKey)) return;

    const legacyTasks = loadJson(LEGACY_TASK_KEY, []);
    if (!Array.isArray(legacyTasks) || !legacyTasks.length) return;

    const lines = legacyTasks
      .filter((task) => task && task.title && task.dueDate)
      .map((task) => `${task.dueDate} ${task.title}`);

    if (lines.length) {
      window.localStorage.setItem(currentNoteKey, lines.join("\n"));
    }
  }

  function loadJson(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function isReminderItem(item) {
    return Boolean(
      item &&
        typeof item.id === "string" &&
        typeof item.title === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(item.dueDate)
    );
  }

  function getIsoWeekInfo(date) {
    const target = startOfDay(date);
    const thursday = new Date(target);
    const day = target.getDay() || 7;
    thursday.setDate(target.getDate() + 4 - day);

    const yearStart = new Date(thursday.getFullYear(), 0, 1);
    const week = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
    const year = thursday.getFullYear();
    const start = startOfIsoWeek(target);

    return {
      year,
      week,
      id: `${year}_W${String(week).padStart(2, "0")}`,
      start,
      end: addDays(start, 6)
    };
  }

  function startOfToday() {
    return startOfDay(new Date());
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function startOfIsoWeek(date) {
    const result = startOfDay(date);
    const day = result.getDay() || 7;
    result.setDate(result.getDate() - day + 1);
    return result;
  }

  function endOfIsoWeek(date) {
    return addDays(startOfIsoWeek(date), 6);
  }

  function addDays(date, amount) {
    const result = new Date(date);
    result.setDate(result.getDate() + amount);
    return result;
  }

  function createValidDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? date
      : null;
  }

  function createDateWithSmartYear(referenceDate, month, day) {
    let date = createValidDate(referenceDate.getFullYear(), month, day);
    if (!date) return null;

    const sixMonthsAgo = new Date(referenceDate);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    if (date < sixMonthsAgo) {
      date = createValidDate(referenceDate.getFullYear() + 1, month, day);
    }

    return date;
  }

  function chineseWeekdayToNumber(value) {
    return {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 7,
      天: 7
    }[value];
  }

  function normalizePrefix(prefix) {
    return prefix
      .replace(/\s+/g, " ")
      .replace(/[\s:：]+$/g, "")
      .trim();
  }

  function getTaskText(line) {
    return line.split("//", 1)[0].trim();
  }

  function removeMatchedDate(text, dateResult) {
    const matchedText = dateResult.matchedText || dateResult.label;
    const index = Number.isInteger(dateResult.matchIndex)
      ? dateResult.matchIndex
      : text.indexOf(matchedText);

    if (index < 0) {
      return text.replace(matchedText, "");
    }

    return `${text.slice(0, index)}${text.slice(index + matchedText.length)}`;
  }

  function removeMatchedTime(text, dateResult) {
    const matchedText = dateResult.timeMatchedText;
    if (!matchedText) return text;

    const index = text.indexOf(matchedText);
    if (index < 0) return text;

    return `${text.slice(0, index)}${text.slice(index + matchedText.length)}`;
  }

  function cleanTaskTitle(title) {
    let result = title.trim();
    const leadingNumberPattern =
      /^(?:(?:[\(（]\s*\d+\s*[\)）])|(?:\d+\s*[\)）.．、:：])|(?:\d+\s+)|(?:[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳])|(?:[一二三四五六七八九十]+\s*[、.．]))[\s—–\-:：、.．]*/u;
    const edgeNoisePattern = /^[\s—–\-:：、.．]+|[\s—–\-:：、.．]+$/g;

    while (leadingNumberPattern.test(result)) {
      result = result.replace(leadingNumberPattern, "");
    }

    result = result.replace(edgeNoisePattern, "");
    return result.trim();
  }

  function normalizeReminderTitle(item) {
    let rawTitle = String(item.title || "").trim();
    let prefix = "";
    const prefixMatch = rawTitle.match(/^\s*\[([^\]]+)\]\s*/);

    if (prefixMatch) {
      prefix = normalizePrefix(prefixMatch[1]);
      rawTitle = rawTitle.slice(prefixMatch[0].length);
    } else if (item.contextPrefix) {
      prefix = normalizePrefix(item.contextPrefix);
    }

    const fallbackDate = parseDateExpression(rawTitle, startOfToday());
    const dateTokens = [
      item.dateLabel,
      item.matchedText,
      fallbackDate && fallbackDate.matchedText
    ].filter(Boolean);

    dateTokens.forEach((token) => {
      rawTitle = rawTitle.split(token).join("");
    });

    const cleanedTitle = cleanTaskTitle(rawTitle);
    if (!cleanedTitle) return prefix ? `[${prefix}]` : "";

    return prefix ? `[${prefix}] ${cleanedTitle}` : cleanedTitle;
  }

  function getIsoWeekStartFromId(weekId) {
    const match = weekId.match(/^(\d{4})_W(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const week = Number(match[2]);
    if (week < 1 || week > 53) return null;

    const weekOneAnchor = new Date(year, 0, 4);
    return addDays(startOfIsoWeek(weekOneAnchor), (week - 1) * 7);
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatAnchorDate(date) {
    return `${date.getMonth() + 1}.${date.getDate()}`;
  }

  function formatFileDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
  }

  function fromDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatFullDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long"
    }).format(date);
  }

  function formatShortDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric"
    }).format(date);
  }

  function formatCompactDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    }).format(date);
  }

  function formatReminderDate(item) {
    const date = fromDateKey(getItemDateKey(item));
    const time = getItemTime(item);
    const waitingOn = isFollowUp(item) && item.waitingOn ? `${item.waitingOn} · ` : "";
    const parts = [waitingOn.replace(/ · $/, ""), formatMonthDay(date), formatWeekday(date)];
    if (time) parts.push(time);
    return parts.filter(Boolean).join(" · ");
  }

  function formatMonthDay(date) {
    return `${date.getMonth() + 1}.${String(date.getDate()).padStart(2, "0")}`;
  }

  function formatWeekday(date) {
    return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  }

  function isSameDay(a, b) {
    return startOfDay(a).getTime() === startOfDay(b).getTime();
  }

  function formatReminderDateLegacy(item) {
    const date = fromDateKey(item.dueDate);
    const month = date.getMonth() + 1;
    const day = date.getDate();

    if (item.dueTime) {
      return `${month}.${day} ${item.dueTime}`;
    }

    return `${formatCompactDate(date)} · ${item.dateLabel}`;
  }

  function formatCompletedAt(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "已处理";

    const time = `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes()
    ).padStart(2, "0")}`;

    if (startOfDay(date).getTime() === startOfToday().getTime()) {
      return `处理于 ${time}`;
    }

    return `处理于 ${date.getMonth() + 1}.${String(date.getDate()).padStart(
      2,
      "0"
    )} ${time}`;
  }

  function getSortTime(item) {
    const itemAt = getItemAt(item);
    if (itemAt) {
      const dueAt = new Date(itemAt).getTime();
      if (!Number.isNaN(dueAt)) return dueAt;
    }

    return fromDateKey(getItemDateKey(item)).getTime();
  }

  function createStableId(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `ddl-${(hash >>> 0).toString(16)}`;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;

    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("./sw.js?v=16", { updateViaCache: "none" })
        .then((registration) => registration.update())
        .catch(() => {
          // file:// and non-secure origins do not support service workers.
        });
    });
  }
})();
