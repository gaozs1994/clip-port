(() => {
  const body = document.body;
  const appShell = document.getElementById("appShell");
  const views = [...document.querySelectorAll(".view")];
  const navButtons = [...document.querySelectorAll("[data-nav]")];
  const toast = document.getElementById("toast");
  const toastTitle = document.getElementById("toastTitle");
  const toastMessage = document.getElementById("toastMessage");
  let toastTimer;

  const refreshIcons = () => {
    if (window.lucide) {
      window.lucide.createIcons({ attrs: { "aria-hidden": "true" } });
    }
  };

  const showToast = (title, message) => {
    toastTitle.textContent = title;
    toastMessage.textContent = message;
    toast.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove("show"), 3200);
  };

  const setView = (viewName) => {
    views.forEach((view) => {
      const isActive = view.dataset.view === viewName;
      view.hidden = !isActive;
      view.classList.toggle("active", isActive);
    });

    document.querySelectorAll(".nav-item").forEach((button) => {
      const isActive = button.dataset.nav === viewName;
      button.classList.toggle("active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    appShell.classList.toggle("tasks-full", viewName === "tasks");
    window.location.hash = viewName;
    document.getElementById("workspace").scrollTop = 0;
  };

  navButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      setView(button.dataset.nav);
    });
  });

  const initialView = window.location.hash.replace("#", "");
  if (["download", "tasks", "history", "settings"].includes(initialView)) {
    setView(initialView);
  }

  window.addEventListener("hashchange", () => {
    const nextView = window.location.hash.replace("#", "");
    if (["download", "tasks", "history", "settings"].includes(nextView)) {
      setView(nextView);
    }
  });

  const themeToggle = document.getElementById("themeToggle");
  themeToggle.addEventListener("click", () => {
    const nextTheme = body.dataset.theme === "dark" ? "light" : "dark";
    body.dataset.theme = nextTheme;
    themeToggle.setAttribute("aria-label", nextTheme === "dark" ? "切换浅色主题" : "切换深色主题");
    themeToggle.setAttribute("title", nextTheme === "dark" ? "切换浅色主题" : "切换深色主题");
    themeToggle.innerHTML = `<i data-lucide="${nextTheme === "dark" ? "sun" : "moon"}"></i>`;
    refreshIcons();
  });

  const sourceUrl = document.getElementById("sourceUrl");
  const pasteDemoUrl = () => {
    sourceUrl.value = "https://video.example.com/watch/nordic-light";
    sourceUrl.focus();
    sourceUrl.select();
  };

  document.getElementById("pasteButton").addEventListener("click", pasteDemoUrl);
  document.getElementById("pasteTopButton").addEventListener("click", pasteDemoUrl);

  const parseForm = document.getElementById("parseForm");
  const parseButton = document.getElementById("parseButton");
  const parseHint = document.getElementById("parseHint");
  const resultPanel = document.getElementById("resultPanel");

  parseForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = sourceUrl.value.trim();
    if (!/^https?:\/\//i.test(value)) {
      showToast("链接格式无效", "请输入以 http:// 或 https:// 开头的媒体链接");
      sourceUrl.focus();
      return;
    }

    parseButton.disabled = true;
    parseButton.innerHTML = '<i class="spin" data-lucide="loader-circle"></i><span>解析中</span>';
    resultPanel.classList.add("is-loading");
    resultPanel.setAttribute("aria-busy", "true");
    parseHint.innerHTML = '<span><i data-lucide="radar"></i>正在连接解析引擎</span>';
    refreshIcons();

    window.setTimeout(() => {
      parseButton.disabled = false;
      parseButton.innerHTML = '<i data-lucide="scan-search"></i><span>重新解析</span>';
      resultPanel.classList.remove("is-loading");
      resultPanel.removeAttribute("aria-busy");
      parseHint.innerHTML = '<span><i data-lucide="shield-check"></i>本机解析</span><span><i data-lucide="list-video"></i>检测到单个视频</span>';
      refreshIcons();
      showToast("解析完成", "已找到 4 个推荐下载方案");
    }, 850);
  });

  const selectedPreset = document.getElementById("selectedPreset");
  const selectPreset = (button) => {
    document.querySelectorAll(".preset-option").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("selected", selected);
      option.setAttribute("aria-checked", String(selected));
    });
    selectedPreset.textContent = button.dataset.preset;
  };

  document.querySelectorAll(".preset-option").forEach((option) => {
    option.addEventListener("click", () => selectPreset(option));
  });

  document.getElementById("resetPreset").addEventListener("click", () => {
    const recommended = document.querySelector('[data-preset="推荐视频"]');
    selectPreset(recommended);
    document.getElementById("resolutionSelect").value = "1440p";
  });

  document.querySelectorAll(".option-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.optionTab;
      document.querySelectorAll(".option-tab").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll("[data-option-panel]").forEach((panel) => {
        const active = panel.dataset.optionPanel === target;
        panel.hidden = !active;
        panel.classList.toggle("active", active);
      });
    });
  });

  document.getElementById("destinationButton").addEventListener("click", () => {
    showToast("保存位置", "原型使用 D:\\Media\\ClipPort");
  });

  document.getElementById("downloadButton").addEventListener("click", () => {
    showToast("任务已加入队列", `${selectedPreset.textContent} · 下载将在可用时自动开始`);
    const current = Number(document.getElementById("navTaskCount").textContent);
    document.getElementById("navTaskCount").textContent = String(current + 1);
    document.getElementById("queueCount").textContent = String(current + 1);
  });

  document.getElementById("closeToast").addEventListener("click", () => toast.classList.remove("show"));

  document.querySelectorAll(".task-toggle, .task-pause").forEach((button) => {
    button.addEventListener("click", () => {
      const paused = button.dataset.paused === "true";
      button.dataset.paused = String(!paused);
      button.setAttribute("title", paused ? "暂停" : "继续");
      button.setAttribute("aria-label", paused ? "暂停任务" : "继续任务");
      button.innerHTML = `<i data-lucide="${paused ? "pause" : "play"}"></i>`;
      const task = button.closest(".queue-task, .task-row");
      const label = task?.querySelector(".task-state-label");
      if (label) label.textContent = paused ? "下载中 · 12.8 MB/s" : "已暂停 · 保留临时文件";
      refreshIcons();
      showToast(paused ? "任务已继续" : "任务已暂停", paused ? "正在从已下载位置继续" : "临时文件已保留");
    });
  });

  document.querySelectorAll(".task-remove").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".task-row")?.remove();
      showToast("任务已从队列移除", "已下载的临时文件未删除");
    });
  });

  document.querySelectorAll(".queue-remove").forEach((button) => {
    button.addEventListener("click", () => {
      button.closest(".queue-task")?.remove();
      const current = Math.max(0, Number(document.getElementById("queueCount").textContent) - 1);
      document.getElementById("queueCount").textContent = String(current);
      document.getElementById("navTaskCount").textContent = String(current);
      showToast("队列已更新", "任务已移除，临时文件未删除");
    });
  });

  document.getElementById("pauseAll").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const paused = button.dataset.paused === "true";
    button.dataset.paused = String(!paused);
    button.setAttribute("aria-label", paused ? "全部暂停" : "全部继续");
    button.innerHTML = `<i data-lucide="${paused ? "pause" : "play"}"></i><span>${paused ? "全部暂停" : "全部继续"}</span>`;
    refreshIcons();
    showToast(paused ? "队列已继续" : "队列已暂停", paused ? "可用任务将按顺序开始" : "所有活动任务已保留进度");
  });

  document.querySelectorAll(".filter-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".filter-tab").forEach((item) => item.classList.toggle("active", item === tab));
    });
  });

  const historySearch = document.getElementById("historySearch");
  historySearch.addEventListener("input", () => {
    const query = historySearch.value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll(".history-row").forEach((row) => {
      const match = row.dataset.search.toLocaleLowerCase().includes(query);
      row.hidden = !match;
      if (match) visible += 1;
    });
    document.getElementById("historyEmpty").hidden = visible !== 0;
  });

  document.getElementById("openFolder").addEventListener("click", () => showToast("下载目录", "D:\\Media\\ClipPort"));
  document.getElementById("checkUpdates").addEventListener("click", () => showToast("已是推荐版本", "yt-dlp 与 FFmpeg 均通过工具链自检"));

  document.querySelectorAll(".history-actions button").forEach((button) => {
    button.addEventListener("click", () => showToast("文件已就绪", "原型中不会实际打开本地文件"));
  });

  document.querySelectorAll(".tool-action").forEach((button) => {
    button.addEventListener("click", () => showToast(button.textContent.trim(), "工具链状态正常，无需处理"));
  });

  document.querySelectorAll(".settings-nav button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".settings-nav button").forEach((item) => item.classList.toggle("active", item === button));
      if (button.textContent.trim() !== "下载") {
        showToast(`${button.textContent.trim()}设置`, "该分类将在下一轮原型中展开");
      }
    });
  });

  window.addEventListener("error", () => {
    document.documentElement.classList.add("asset-fallback");
  });

  refreshIcons();
})();
