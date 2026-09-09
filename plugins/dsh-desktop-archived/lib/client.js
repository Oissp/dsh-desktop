window.__ModuleLoader__.load({
	id: "dsh-desktop-archived",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		// ---- CSS ----
		// Geometry and tokens mirror ui-workspace's session rows so an archived
		// row reads as the same kind of thing as a live one.
		const tagId = "dsh-desktop-archived/panel.css";
		const css = [
			".dsh-arch{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}",
			".dsh-arch-head{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:8px;height:60px;padding:8px 20px;border-bottom:.5px solid var(--dsw-alias-border-l3)}",
			".dsh-arch-head h2{margin:0;font-size:16px;font-weight:600;line-height:24px;flex:1}",
			".dsh-arch-count{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}",
			".dsh-arch-list{flex:1;min-height:0;overflow-y:auto;padding:8px 12px}",
			".dsh-arch-empty{padding:48px 20px;color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:20px;text-align:center}",

			// Row: ui-workspace sessionRow geometry (32px, radius 8, gap 6, pad 0 8).
			".dsh-arch-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary)}",
			".dsh-arch-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-arch-slot{flex:none;display:inline-flex;justify-content:center;align-items:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;line-height:20px}",
			".dsh-arch-time{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}",
			".dsh-arch-actions{flex:none;display:none;align-items:center;gap:12px;height:20px}",
			".dsh-arch-row:hover .dsh-arch-actions{display:inline-flex}",
			".dsh-arch-row:hover .dsh-arch-time{display:none}",
			".dsh-arch-iconbtn{flex:none;display:inline-flex;justify-content:center;align-items:center;width:16px;height:16px;padding:0;border:none;border-radius:4px;background:0 0;cursor:pointer;color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-iconbtn:hover{color:var(--dsw-alias-state-error-primary)}",
			".dsh-arch-confirm{flex:none;display:inline-flex;align-items:center;gap:4px;font-size:12px;line-height:20px}",
			".dsh-arch-confirm-label{color:var(--dsw-alias-state-error-primary)}",
			".dsh-arch-confirm button{padding:1px 6px;border:none;border-radius:4px;background:0 0;cursor:pointer;font:inherit}",
			".dsh-arch-yes{color:var(--dsw-alias-state-error-primary)}",
			".dsh-arch-yes:hover{background:var(--dsw-alias-interactive-bg-hover)}",
			".dsh-arch-no{color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-no:hover{background:var(--dsw-alias-interactive-bg-hover)}",

			// Read-only viewer
			".dsh-arch-view{display:flex;flex-direction:column;height:100%;min-height:0}",
			".dsh-arch-view-head{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:10px;height:60px;padding:8px 20px;border-bottom:.5px solid var(--dsw-alias-border-l3)}",
			".dsh-arch-back{padding:4px 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:8px;background:var(--dsw-alias-button-elevated-fill);cursor:pointer;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}",
			".dsh-arch-back:hover{background:var(--dsw-alias-button-floating-hover)}",
			".dsh-arch-view-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:600;line-height:24px}",
			".dsh-arch-badge{flex:none;padding:2px 8px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsh-arch-view-body{flex:1;min-height:0;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:12px;width:100%;max-width:800px;margin:0 auto}",
			".dsh-arch-msg{max-width:85%;padding:10px 14px;border-radius:10px;white-space:pre-wrap;word-break:break-word;font-size:14px;line-height:1.6}",
			".dsh-arch-msg-user{align-self:flex-end;background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}",
			".dsh-arch-msg-assistant{align-self:flex-start;border:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}",
			// Hover card body (the card chrome itself is HoverCard's own).
			".dsh-arch-hover{display:flex;flex-direction:column;gap:4px;max-width:360px}",
			".dsh-arch-hover-title{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}",
			".dsh-arch-hover-path{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}",
			".dsh-arch-hover-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-note{padding:40px 0;color:var(--dsw-alias-label-tertiary);font-size:14px;text-align:center}",
			".dsh-arch-err{padding:40px 0;color:var(--dsw-alias-state-error-primary);font-size:14px;text-align:center}",
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-archived";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Flatten a message's blocks into display text. */
		function blockText(blocks) {
			const parts = [];
			for (const b of blocks) {
				if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
				else if (b.type === "reasoning" && typeof b.text === "string") parts.push("\u{1F4AD} " + b.text);
				else if (b.type === "tool-call") parts.push("\u{1F527} " + (b.name || ""));
				else if (b.type === "tool-result" && b.content) parts.push(blockText(b.content));
			}
			return parts.join("\n");
		}

		/**
		 * Row time column, using the shared bucketing so this surface and the
		 * workspace browser never disagree about the same session's age.
		 */
		function timeLabel(ts, now, t) {
			if (typeof ts !== "number") return "";
			const { unit, n } = primitives.relativeTime(ts, now);
			return unit === "now" ? t("time.now") : t("time." + unit, { n });
		}

		/** Hover-card variant: distances take the ago template, 'now' stays bare. */
		function hoverTimeLabel(ts, now, t) {
			if (typeof ts !== "number") return "";
			const { unit, n } = primitives.relativeTime(ts, now);
			return unit === "now" ? t("time.now") : t("time.ago", { t: t("time." + unit, { n }) });
		}

		/** Read-only transcript of one archived session. */
		function ArchivedViewer({ sessionId, title, onBack, t }) {
			const [state, setState] = react.useState({ phase: "loading", messages: [], title });

			react.useEffect(() => {
				let cancelled = false;
				(async () => {
					const desktop = window.__desktop__;
					if (!desktop || !desktop.getHistory) {
						if (!cancelled) setState({ phase: "error", messages: [], title, error: t("error.bridge") });
						return;
					}
					try {
						const result = await desktop.getHistory(sessionId);
						if (cancelled) return;
						if (!result) {
							setState({ phase: "error", messages: [], title, error: t("error.load") });
							return;
						}
						let found = title;
						const msgs = [];
						for (const evt of result.events || []) {
							if (evt.kind === "title" && typeof evt.title === "string") found = evt.title;
							if (evt.kind !== "user-message" && evt.kind !== "assistant-end") continue;
							const blocks = evt.message && evt.message.blocks;
							if (!blocks) continue;
							const text = blockText(blocks);
							if (!text.trim()) continue;
							msgs.push({ role: evt.kind === "user-message" ? "user" : "assistant", text });
						}
						setState({ phase: "ready", messages: msgs, title: found || title });
					} catch (err) {
						if (!cancelled) setState({ phase: "error", messages: [], title, error: String(err) });
					}
				})();
				return () => { cancelled = true; };
			}, [sessionId, title, t]);

			// Reference-stable per locale: a new identity discards MarkdownText's
			// render cache.
			const mdLabels = react.useMemo(() => ({
				code: { copyLabel: t("hover.copy.code"), copiedLabel: t("hover.copied") },
				footnotes: t("markdown.footnotes")
			}), [t]);

			let body;
			if (state.phase === "loading") body = jsx("div", { className: "dsh-arch-note", children: t("viewer.loading") });
			else if (state.phase === "error") body = jsx("div", { className: "dsh-arch-err", children: state.error });
			else if (state.messages.length === 0) body = jsx("div", { className: "dsh-arch-note", children: t("viewer.empty") });
			else body = state.messages.map((m, i) => jsx("div", {
				className: "dsh-arch-msg " + (m.role === "user" ? "dsh-arch-msg-user" : "dsh-arch-msg-assistant"),
				// Assistant text is Markdown in the live conversation; render it the
				// same way here so an archived transcript is not visibly poorer.
				children: m.role === "user"
					? m.text
					: jsx(primitives.MarkdownText, { text: m.text, labels: mdLabels })
			}, i));

			return jsxs("div", {
				className: "dsh-arch-view",
				children: [
					jsxs("div", {
						className: "dsh-arch-view-head",
						children: [
							jsx("button", { type: "button", className: "dsh-arch-back", onClick: onBack, children: t("viewer.back") }),
							jsx("span", { className: "dsh-arch-view-title", children: state.title || t("session.fallback") }),
							jsx("span", { className: "dsh-arch-badge", children: t("viewer.readonly") }),
						]
					}),
					jsx("div", { className: "dsh-arch-view-body", children: body }),
				]
			});
		}

		/** One archived row, with the workspace browser's hover card for detail. */
		function ArchivedRow({ session, now, confirming, onOpen, onAskDelete, onConfirmDelete, onCancelDelete, t }) {
			const title = session.title || t("session.fallback");
			const trailing = confirming
				? jsxs("span", {
					className: "dsh-arch-confirm",
					onClick: (e) => e.stopPropagation(),
					children: [
						jsx("span", { className: "dsh-arch-confirm-label", children: t("delete.confirm") }),
						jsx("button", { type: "button", className: "dsh-arch-yes", onClick: onConfirmDelete, children: t("delete.yes") }),
						jsx("button", { type: "button", className: "dsh-arch-no", onClick: onCancelDelete, children: t("delete.no") }),
					]
				})
				: jsxs(Fragment, {
					children: [
						jsx("span", { className: "dsh-arch-time", children: timeLabel(session.archivedAt, now, t) }),
						jsx("span", {
							className: "dsh-arch-actions",
							children: jsx("button", {
								type: "button",
								className: "dsh-arch-iconbtn",
								"aria-label": t("delete.aria", { name: title }),
								onClick: (e) => { e.stopPropagation(); onAskDelete(); },
								children: jsx(primitives.IconTrashOutline16, {})
							})
						}),
					]
				});

			return jsx(primitives.HoverCard, {
				disabled: confirming,
				copyText: session.sessionId,
				copyLabel: t("hover.copy"),
				copiedLabel: t("hover.copied"),
				anchor: jsxs("div", {
					className: "dsh-arch-row",
					role: "button",
					"aria-label": title,
					onClick: () => { if (!confirming) onOpen(); },
					children: [
						jsx("span", {
							className: "dsh-arch-slot",
							"aria-hidden": "true",
							children: jsx(primitives.IconArchiveOutline20, { size: 16 })
						}),
						jsx("span", { className: "dsh-arch-title", children: title }),
						trailing,
					]
				}),
				content: jsxs("div", {
					className: "dsh-arch-hover",
					children: [
						jsx("div", { className: "dsh-arch-hover-title", children: title }),
						session.cwd && jsx("div", { className: "dsh-arch-hover-path", children: session.cwd }),
						typeof session.archivedAt === "number" && jsx("div", {
							className: "dsh-arch-hover-meta",
							children: t("hover.archived", { time: hoverTimeLabel(session.archivedAt, now, t) })
						}),
					]
				})
			});
		}

		/** The archived-sessions main panel: list, or one session's transcript. */
		function ArchivedPanel({ t }) {
			const [sessions, setSessions] = react.useState([]);
			const [viewing, setViewing] = react.useState(null);
			const [pendingDelete, setPendingDelete] = react.useState(null);
			const [now, setNow] = react.useState(() => Date.now());

			const refresh = react.useCallback(async () => {
				const desktop = window.__desktop__;
				if (!desktop || !desktop.listArchived) return;
				try {
					const list = await desktop.listArchived();
					setSessions(list || []);
					setNow(Date.now());
				} catch { /* transient bridge failure: keep the last list */ }
			}, []);

			react.useEffect(() => {
				refresh();
				const id = setInterval(refresh, 15000);
				return () => clearInterval(id);
			}, [refresh]);

			if (viewing) {
				return jsx(ArchivedViewer, {
					sessionId: viewing.sessionId,
					title: viewing.title,
					onBack: () => setViewing(null),
					t
				});
			}

			const remove = async (sessionId, cwd) => {
				const desktop = window.__desktop__;
				if (desktop && desktop.hardDeleteSession) await desktop.hardDeleteSession(sessionId, cwd);
				setPendingDelete(null);
				refresh();
			};

			return jsxs("div", {
				className: "dsh-arch",
				children: [
					jsxs("div", {
						className: "dsh-arch-head",
						children: [
							jsx("h2", { children: t("panel.title") }),
							sessions.length > 0 && jsx("span", { className: "dsh-arch-count", children: sessions.length }),
						]
					}),
					jsx("div", {
						className: "dsh-arch-list",
						children: sessions.length === 0
							? jsx("div", { className: "dsh-arch-empty", children: t("panel.empty") })
							: sessions.map((s) => jsx(ArchivedRow, {
								session: s,
								now,
								t,
								confirming: pendingDelete === s.sessionId,
								onOpen: () => setViewing(s),
								onAskDelete: () => setPendingDelete(s.sessionId),
								onConfirmDelete: () => remove(s.sessionId, s.cwd),
								onCancelDelete: () => setPendingDelete(null)
							}, s.sessionId))
					}),
				]
			});
		}

		/** Sidebar rail glyph: the same archive icon dsh uses for its archive action. */
		function ArchiveIcon({ size }) {
			return jsx(primitives.IconArchiveOutline20, { size });
		}

		const PANEL_ID = "archived";
		const NS = "desktopArchived";

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"panel.title": "归档会话",
			"panel.empty": "暂无归档会话",
			"session.fallback": "归档会话",
			"sidebar.label": "归档",
			"viewer.back": "← 返回",
			"viewer.readonly": "只读",
			"viewer.loading": "加载中…",
			"viewer.empty": "无消息记录",
			"error.bridge": "桌面桥不可用",
			"error.load": "加载失败",
			"delete.confirm": "确认删除？",
			"delete.yes": "删除",
			"delete.no": "取消",
			"delete.aria": "彻底删除 {name}（含磁盘目录）",
			"hover.archived": "归档于 {time}",
			"hover.copy": "复制会话 ID",
			"hover.copy.code": "复制代码",
			"hover.copied": "已复制",
			"markdown.footnotes": "脚注",
			"time.now": "刚刚",
			"time.minutes": "{n}分钟",
			"time.hours": "{n}小时",
			"time.days": "{n}天",
			"time.months": "{n}个月",
			"time.years": "{n}年",
			"time.ago": "{t}前",
		};

		const en = {
			"panel.title": "Archived Sessions",
			"panel.empty": "No archived sessions",
			"session.fallback": "Archived session",
			"sidebar.label": "Archive",
			"viewer.back": "← Back",
			"viewer.readonly": "Read-only",
			"viewer.loading": "Loading…",
			"viewer.empty": "No messages",
			"error.bridge": "Desktop bridge unavailable",
			"error.load": "Failed to load",
			"delete.confirm": "Delete permanently?",
			"delete.yes": "Delete",
			"delete.no": "Cancel",
			"delete.aria": "Permanently delete {name}, including its directory",
			"hover.archived": "Archived {time}",
			"hover.copy": "Copy session ID",
			"hover.copy.code": "Copy code",
			"hover.copied": "Copied",
			"markdown.footnotes": "Footnotes",
			"time.now": "now",
			"time.minutes": "{n}min",
			"time.hours": "{n}h",
			"time.days": "{n}d",
			"time.months": "{n}mo",
			"time.years": "{n}y",
			"time.ago": "{t} ago",
		};

		// Cordis service names (NOT package names): the runtime resolves these
		// against provided services, so a package name here leaves the plugin
		// pending forever. `slots` for registration, `layout` because the sidebar
		// row addresses a `main` panel, `locale` for the dictionaries.
		const inject = [
			"slots",
			"layout",
			"locale"
		];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "desktop-archived: dictionaries");
			// Stable per namespace, and reads the active locale at call time, so the
			// label function below re-resolves on a language switch.
			const t = ctx.locale.bind(NS);

			// Declaration-aware injection: the declaring packages (ui-sidebar for
			// sidebar.panellist, ui-layout for main) may activate before OR after
			// this plugin. Registering directly throws "slot is not declared" when
			// we win the race; inject() defers until the declaration exists.
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 90,
				label: () => t("sidebar.label")
			}, ArchiveIcon));

			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
				locale: NS
			}, ArchivedPanel));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});