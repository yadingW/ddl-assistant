(function () {
  const STORAGE_KEY = "ddl-assistant.tasks.v1";
  const input = document.getElementById("pasteInput");
  const addBtn = document.getElementById("addBtn");
  const clearInputBtn = document.getElementById("clearInputBtn");
  const clearDoneBtn = document.getElementById("clearDoneBtn");
  const filters = Array.from(document.querySelectorAll(".filter"));

  const lists = {
    today: document.getElementById("todayList"),
    week: document.getElementById("weekList"),
    future: document.getElementById("futureList")
  };

  const counts = {
    today: document.getElementById("todayCount"),
    week: document.getElementById("weekCount"),
    future: document.getElementById("futureCount"),
    total: document.getElementById("totalCount"),
    open: document.getElementById("openCount")
  };

  let activeFilter = "all";
  let tasks = loadTasks();

  document.getElementById("todayText").textContent = `今天是 ${formatDisplayDate(startOfToday())}`;

  addBtn.addEventListener("click", addFromInput);
  clearInputBtn.addEventListener("click", () => {
    input.value = "";
    input.focus();
  });

  clearDoneBtn.addEventListener("click", () => {
    tasks = tasks.filter((task) => !task.done);
    saveTasks();
    render();
  });

  filters.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      filters.forEach((item) => item.classList.toggle("active", item === button));
      render();
    });
  });

  input.addEventListener("paste", () => {
    window.setTimeout(() => {
      if (input.value.trim()) {
        addBtn.focus();
      }
    }, 0);
  });

  render();

  function addFromInput() {
    const parsed = parsePastedText(input.value);
    if (!parsed.length) {
      input.focus();
      return;
    }

    tasks = [...tasks, ...parsed];
    saveTasks();
    input.value = "";
    render();
  }

  function parsePastedText(text) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter(Boolean);
  }

  function parseLine(line) {
    const cells = line.split("\t").map((cell) => cell.trim()).filter(Boolean);
    const sourceParts = cells.length > 1 ? cells : [line];
    let dueDate = null;
    let matchedText = "";

    for (const part of sourceParts) {
      const match = findDate(part);
      if (match) {
        dueDate = match.date;
        matchedText = match.raw;
        break;
      }
    }

    if (!dueDate) {
      return null;
    }

    const title = sourceParts
      .map((part) => normalizeSpaces(part.replace(matchedText, "")))
      .filter(Boolean)
      .join(" / ");

    return {
      id: createId(),
      title: title || line,
      dueDate: toDateKey(dueDate),
      done: false,
      createdAt: new Date().toISOString()
    };
  }

  function findDate(text) {
    const patterns = [
      /(20\d{2}|19\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})日?/,
      /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2}|19\d{2})\b/,
      /(\d{1,2})月(\d{1,2})日/
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match) {
        continue;
      }

      let year;
      let month;
      let day;

      if (pattern === patterns[0]) {
        year = Number(match[1]);
        month = Number(match[2]);
        day = Number(match[3]);
      } else if (pattern === patterns[1]) {
        const first = Number(match[1]);
        const second = Number(match[2]);
        year = Number(match[3]);
        month = first > 12 ? second : first;
        day = first > 12 ? first : second;
      } else {
        const today = startOfToday();
        year = today.getFullYear();
        month = Number(match[1]);
        day = Number(match[2]);
      }

      const date = new Date(year, month - 1, day);
      if (isValidDate(date, year, month, day)) {
        return { date, raw: match[0].trim() };
      }
    }

    return null;
  }

  function render() {
    const visibleTasks = tasks.filter((task) => {
      if (activeFilter === "open") return !task.done;
      if (activeFilter === "done") return task.done;
      return true;
    });

    const grouped = {
      today: [],
      week: [],
      future: []
    };

    visibleTasks
      .slice()
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .forEach((task) => {
        grouped[getGroup(task.dueDate)].push(task);
      });

    Object.entries(lists).forEach(([group, list]) => {
      list.innerHTML = "";
      if (!grouped[group].length) {
        list.appendChild(document.getElementById("emptyTemplate").content.cloneNode(true));
        counts[group].textContent = "0";
        return;
      }

      grouped[group].forEach((task) => list.appendChild(createTaskElement(task)));
      counts[group].textContent = String(grouped[group].length);
    });

    counts.total.textContent = String(tasks.length);
    counts.open.textContent = String(tasks.filter((task) => !task.done).length);
  }

  function createTaskElement(task) {
    const item = document.createElement("article");
    item.className = `task-item${task.done ? " done" : ""}`;

    const checkbox = document.createElement("input");
    checkbox.className = "task-check";
    checkbox.type = "checkbox";
    checkbox.checked = task.done;
    checkbox.setAttribute("aria-label", "切换完成状态");
    checkbox.addEventListener("change", () => {
      tasks = tasks.map((current) =>
        current.id === task.id ? { ...current, done: checkbox.checked } : current
      );
      saveTasks();
      render();
    });

    const main = document.createElement("div");
    main.className = "task-main";

    const title = document.createElement("div");
    title.className = "task-title";
    title.textContent = task.title;

    const meta = document.createElement("div");
    meta.className = "task-meta";

    const date = document.createElement("span");
    date.textContent = formatDisplayDate(fromDateKey(task.dueDate));

    const badge = document.createElement("span");
    badge.className = `badge ${getDateBadgeClass(task.dueDate)}`;
    badge.textContent = getDateLabel(task.dueDate);

    meta.append(date, badge);
    main.append(title, meta);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete-btn";
    deleteBtn.type = "button";
    deleteBtn.setAttribute("aria-label", "删除任务");
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => {
      tasks = tasks.filter((current) => current.id !== task.id);
      saveTasks();
      render();
    });

    item.append(checkbox, main, deleteBtn);
    return item;
  }

  function getGroup(dateKey) {
    const today = startOfToday();
    const date = fromDateKey(dateKey);
    if (date <= today) return "today";
    if (date <= endOfWeek(today)) return "week";
    return "future";
  }

  function getDateLabel(dateKey) {
    const today = startOfToday();
    const date = fromDateKey(dateKey);
    if (date < today) return "已逾期";
    if (date.getTime() === today.getTime()) return "今天";
    if (date <= endOfWeek(today)) return "本周";
    return "未来";
  }

  function getDateBadgeClass(dateKey) {
    const today = startOfToday();
    const date = fromDateKey(dateKey);
    if (date < today) return "overdue";
    if (date.getTime() === today.getTime()) return "today";
    return "";
  }

  function loadTasks() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : [];
      return Array.isArray(saved) ? saved.filter(isTask) : [];
    } catch {
      return [];
    }
  }

  function saveTasks() {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  }

  function isTask(task) {
    return Boolean(
      task &&
        typeof task.id === "string" &&
        typeof task.title === "string" &&
        typeof task.dueDate === "string" &&
        typeof task.done === "boolean"
    );
  }

  function startOfToday() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function endOfWeek(today) {
    const day = today.getDay() || 7;
    const end = new Date(today);
    end.setDate(today.getDate() + (7 - day));
    return end;
  }

  function toDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromDateKey(key) {
    const [year, month, day] = key.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function formatDisplayDate(date) {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short"
    }).format(date);
  }

  function isValidDate(date, year, month, day) {
    return (
      date instanceof Date &&
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function normalizeSpaces(value) {
    return value.replace(/\s+/g, " ").trim();
  }

  function createId() {
    if (window.crypto && window.crypto.randomUUID) {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
})();
