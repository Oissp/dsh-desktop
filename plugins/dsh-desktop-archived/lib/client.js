window.__ModuleLoader__.load({
	id: "dsh-desktop-archived",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const { jsx, jsxs, Fragment } = require("react/jsx-runtime");
		const react = require("react");
		const react_dom = require("react-dom");
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
			// Icon-free on purpose — the section header carries the archive glyph.
			".dsh-arch-row{box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 8px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary)}",
			".dsh-arch-row:hover{background:var(--dsw-alias-interactive-bg-hover)}",
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

			// Read-only viewer. Message rendering mirrors ui-chat's MessageItem
			// (user bubble) and AssistantMarkdown (full-width assistant body) so
			// an archived transcript reads exactly like the live conversation:
			// same content column (--dsh-chat-content-width), same flow gap, same
			// bubble / markdown / reasoning-row / command-card tokens.
			".dsh-arch-view{display:flex;flex-direction:column;height:100%;min-height:0}",
			".dsh-arch-view-head{box-sizing:border-box;flex:none;display:flex;align-items:center;gap:10px;height:60px;padding:8px 20px;border-bottom:.5px solid var(--dsw-alias-border-l3)}",
			".dsh-arch-view-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px;font-weight:600;line-height:24px}",
			".dsh-arch-badge{flex:none;padding:2px 8px;border-radius:4px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}",
			".dsh-arch-view-body{flex:1;min-height:0;overflow-y:auto;padding:16px calc(var(--dsh-composer-side-clearance, 0px) + 16px);display:flex;flex-direction:column;gap:var(--dsh-chat-flow-gap,16px);width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto}",
			// User row — ui-chat MessageItem.userRow / userStack / bubble.
			".dsh-arch-urow{flex-direction:column;align-items:flex-end;gap:6px;display:flex}",
			".dsh-arch-ustack{min-width:0;max-width:min(calc(var(--dsh-chat-content-width,748px) * .702), 82%);flex-direction:column;align-items:flex-end;gap:8px;display:flex}",
			".dsh-arch-bubble{background:var(--dsw-specific-bubble);max-width:100%;font-size:var(--dsh-content-font-size,14px);line-height:calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-word;border-radius:22px;padding:10px 16px}",
			// Assistant row — ui-chat AssistantMarkdown.root / .body.
			".dsh-arch-aroot{font-size:var(--dsh-content-font-size,14px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-primary);flex-direction:column;display:flex}",
			".dsh-arch-abody{flex-direction:column;gap:16px;display:flex}",
			".dsh-arch-err-line{color:var(--dsw-alias-state-error-primary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}",
			// Time + copy chrome — ui-chat MessageIconActions.
			".dsh-arch-msg-actions{height:calc(28px + var(--dsh-content-font-delta,0px));align-items:center;gap:8px;display:flex}",
			".dsh-arch-msg-actions-assistant{margin-top:16px;margin-left:-6px}",
			".dsh-arch-msg-time{font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap}",
			".dsh-arch-msg-time-start{padding-right:12px}",
			".dsh-arch-copy{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex}",
			".dsh-arch-copy:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}",
			".dsh-arch-copy svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}",
			// Reasoning disclosure — ui-chat ReasoningRow.
			".dsh-arch-reason{flex-direction:column;display:flex}",
			".dsh-arch-reason:not([data-expanded]){contain:size layout;height:calc(24px + var(--dsh-content-font-delta,0px))}",
			".dsh-arch-reason-row{position:relative;overflow:hidden}",
			".dsh-arch-reason-leading{flex-shrink:0}",
			".dsh-arch-reason-title{font-weight:400}",
			".dsh-arch-reason-chevron{color:var(--dsw-alias-label-secondary)}",
			".dsh-arch-reason-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}",
			".dsh-arch-reason-summary{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;flex:auto;overflow:hidden}",
			".dsh-arch-reason-summary span{text-overflow:ellipsis;display:block;overflow:hidden}",
			".dsh-arch-reason-body{padding:4px 0 4px calc(22px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:pre-wrap;word-break:break-word}",
			// Tool command card — ui-chat GenericCommandCard.
			".dsh-arch-cmd{flex-direction:column;display:flex}",
			".dsh-arch-cmd-row{position:relative;overflow:hidden}",
			".dsh-arch-cmd-leading{flex-shrink:0}",
			".dsh-arch-cmd-title{font-weight:400}",
			".dsh-arch-cmd-chevron{color:var(--dsw-alias-label-secondary)}",
			".dsh-arch-cmd-sep{background:var(--dsw-alias-label-caption);border-radius:1px;flex:none;width:2px;height:2px;margin:0 8px}",
			".dsh-arch-cmd-summary{min-width:0;color:var(--dsw-alias-label-tertiary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));text-overflow:ellipsis;white-space:nowrap;flex:auto;overflow:hidden}",
			".dsh-arch-cmd-summary[data-error]{color:var(--dsw-alias-state-error-primary)}",
			".dsh-arch-cmd-body{border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-markdown-code-block);max-height:260px;color:var(--dsw-alias-label-primary);font:var(--dsw-font-markdown-code-block-small);white-space:pre-wrap;border-radius:12px;margin:4px 0 4px 4px;padding:12px 16px;overflow:auto}",
			// Hover card body (the card chrome itself is HoverCard's own).
			".dsh-arch-hover{display:flex;flex-direction:column;gap:4px;max-width:360px}",
			".dsh-arch-hover-title{font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}",
			".dsh-arch-hover-path{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);word-break:break-all}",
			".dsh-arch-hover-meta{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-note{padding:40px 0;color:var(--dsw-alias-label-tertiary);font-size:14px;text-align:center}",
			".dsh-arch-err{padding:40px 0;color:var(--dsw-alias-state-error-primary);font-size:14px;text-align:center}",

			// Sidebar group: a collapsible "归档" section pinned below the
			// workspace browser (portal target is the shell's regionArea). The
			// header carries the official archive icon plus a disclosure chevron
			// (the workspace's own triangle); the rows stay icon-free so the
			// section reads as a plain list of archived titles.
			".dsh-arch-sidebar{box-sizing:border-box;flex:none;border-top:.5px solid var(--dsw-alias-border-l3);margin-top:4px;padding:6px 2px 6px}",
			".dsh-arch-sidebar-head{box-sizing:border-box;display:flex;align-items:center;gap:6px;width:100%;height:32px;padding:0 8px;border-radius:8px;cursor:pointer;user-select:none;background:0 0;border:none;text-align:left;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:20px}",
			".dsh-arch-sidebar-head:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}",
			".dsh-arch-sidebar-icon{flex:none;display:inline-flex;justify-content:center;align-items:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary)}",
			".dsh-arch-sidebar-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dsh-arch-sidebar-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;font-variant-numeric:tabular-nums}",
			".dsh-arch-sidebar-chevron{flex:none;display:inline-flex;justify-content:center;align-items:center;width:16px;height:20px;color:var(--dsw-alias-label-tertiary);transition:transform .12s var(--ds-ease-in-out)}",
			".dsh-arch-sidebar-head.is-open .dsh-arch-sidebar-chevron{transform:rotate(90deg)}",
			".dsh-arch-sidebar-list{display:flex;flex-direction:column;gap:1px;padding:2px 4px 0;max-height:min(40vh, 320px);overflow-y:auto}",
			// Rail (collapsed column): a single affordance that expands the sidebar.
			".dsh-arch-rail{box-sizing:border-box;flex:none;display:flex;justify-content:center;padding:10px 0 4px}",
			".dsh-arch-rail-btn{width:36px;height:36px;border-radius:8px;border:none;background:0 0;color:var(--dsw-alias-label-primary);cursor:pointer;display:inline-flex;justify-content:center;align-items:center}",
			".dsh-arch-rail-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}",
		].join("\n");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + tagId + '"]') === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-desktop-archived";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		/** Flatten a message's blocks into plain copyable text (no decorations). */
		function blockText(blocks) {
			const parts = [];
			for (const b of blocks) {
				if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
				else if (b.type === "tool-result" && b.content) parts.push(blockText(b.content));
			}
			return parts.join("\n");
		}

		/** A message is worth rendering if any block carries visible content. */
		function hasRenderable(blocks) {
			for (const b of blocks) {
				if (b.type === "text" && b.text) return true;
				if (b.type === "reasoning" && b.text) return true;
				if (b.type === "tool-call") return true;
				if (b.type === "tool-result" && (b.content || b.isError)) return true;
			}
			return false;
		}

		/** First non-empty line (reasoning row summary), mirroring ui-chat. */
		function firstLine(text) {
			const newline = text.indexOf("\n");
			return newline === -1 ? text : text.slice(0, newline);
		}

		/**
		 * Compact local clock for the actions row, mirroring ui-chat's
		 * formatMessageClock: same day → HH:mm; earlier this year → M月D日 HH:mm;
		 * other years → Y年M月D日 HH:mm.
		 */
		function pad2(n) { return String(n).padStart(2, "0"); }
		function clockLabel(time, t) {
			const d = new Date(time);
			const n = new Date();
			const clock = pad2(d.getHours()) + ":" + pad2(d.getMinutes());
			if (d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()) return clock;
			const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
			return (d.getFullYear() === n.getFullYear() ? t("clock.md", params) : t("clock.ymd", params)) + " " + clock;
		}

		/**
		 * Time + copy chrome under a message, mirroring ui-chat's
		 * MessageIconActions (minus branch/usage actions the archive can't do).
		 */
		function ArchActions({ text, time, align, t }) {
			const [copied, setCopied] = react.useState(false);
			const timerRef = react.useRef(null);
			react.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
			const onCopy = () => {
				if (copied) return;
				primitives.writeClipboard(text).then((ok) => {
					if (!ok) return;
					setCopied(true);
					timerRef.current = setTimeout(() => setCopied(false), 1000);
				});
			};
			return jsxs("div", {
				className: "dsh-arch-msg-actions" + (align === "assistant" ? " dsh-arch-msg-actions-assistant" : ""),
				children: [
					typeof time === "number" && jsx("span", {
						className: "dsh-arch-msg-time dsh-arch-msg-time-start",
						children: clockLabel(time, t)
					}),
					jsx(primitives.Tooltip, {
						label: copied ? t("hover.copied") : t("viewer.copy"),
						side: "bottom",
						children: jsx("button", {
							type: "button",
							className: "dsh-arch-copy",
							"aria-label": copied ? t("hover.copied") : t("viewer.copy"),
							onClick: onCopy,
							children: copied ? jsx(primitives.IconCheckOutline16, {}) : jsx(primitives.IconCopyOutline16, {})
						})
					})
				]
			});
		}

		/** User bubble, mirroring ui-chat's UserStyleBubble structure. */
		function ArchUserMessage({ blocks, time, t }) {
			const text = blockText(blocks);
			return jsxs("div", {
				className: "dsh-arch-urow",
				children: [
					jsx("div", {
						className: "dsh-arch-ustack",
						children: jsx("div", { className: "dsh-arch-bubble", children: text })
					}),
					jsx(ArchActions, { text, time, align: "user", t })
				]
			});
		}

		/** Collapsible 思考 disclosure, mirroring ui-chat's ReasoningRow. */
		function ArchReasoning({ text, t }) {
			const [expanded, setExpanded] = react.useState(false);
			const summary = firstLine(text).replaceAll("**", "");
			return jsxs("div", {
				className: "dsh-arch-reason",
				"data-variant": "think",
				"data-state": "ok",
				"data-expanded": expanded || void 0,
				children: [
					jsx(primitives.DisclosureRow, {
						rowClassName: "dsh-arch-reason-row",
						leadingClassName: "dsh-arch-reason-leading",
						titleClassName: "dsh-arch-reason-title",
						chevronClassName: "dsh-arch-reason-chevron",
						icon: jsx(primitives.IconThinkOutline14, { size: 14 }),
						title: t("viewer.think"),
						open: expanded,
						expandable: true,
						expandOnRowClick: true,
						onToggle: () => setExpanded((v) => !v),
						collapsedContent: jsxs(Fragment, { children: [
							jsx("span", { className: "dsh-arch-reason-sep", "aria-hidden": "true" }),
							jsx("span", { className: "dsh-arch-reason-summary", children: jsx("span", { children: summary }) })
						] }),
						children: jsx("div", { className: "dsh-arch-reason-body", children: text })
					})
				]
			});
		}

		/** Tool command card, mirroring ui-chat's GenericCommandCard chrome. */
		function ArchCommand({ name, args, summary, isError, t }) {
			const [expanded, setExpanded] = react.useState(false);
			const body = args ? args : null;
			const open = expanded && body !== null;
			return jsxs("div", {
				className: "dsh-arch-cmd",
				"data-state": isError ? "error" : "ok",
				children: [
					jsx(primitives.DisclosureRow, {
						rowClassName: "dsh-arch-cmd-row",
						leadingClassName: "dsh-arch-cmd-leading",
						titleClassName: "dsh-arch-cmd-title",
						chevronClassName: "dsh-arch-cmd-chevron",
						icon: isError ? jsx(primitives.StateDot, { state: "error" }) : jsx(primitives.IconApiOutline14, { size: 14 }),
						title: name || t("viewer.command"),
						open,
						expandable: body !== null,
						expandOnRowClick: true,
						keepContentWhenOpen: true,
						onToggle: () => setExpanded((v) => !v),
						collapsedContent: jsxs(Fragment, { children: [
							jsx("span", { className: "dsh-arch-cmd-sep", "aria-hidden": "true" }),
							jsx("span", { className: "dsh-arch-cmd-summary", "data-error": isError || void 0, children: summary })
						] }),
						children: body === null ? null : jsx("pre", { className: "dsh-arch-cmd-body", children: body })
					})
				]
			});
		}

		/**
		 * Assistant message body: full-width markdown text, reasoning disclosures
		 * and tool cards interleaved in block order — the same visual vocabulary
		 * as ui-chat's AssistantMarkdown + command-card trajectory.
		 */
		function ArchAssistantBody({ blocks, mdLabels, error, t }) {
			const out = [];
			for (let i = 0; i < blocks.length; i++) {
				const b = blocks[i];
				if (b.type === "text") {
					if (typeof b.text !== "string" || !b.text) continue;
					out.push(jsx(primitives.MarkdownText, { text: b.text, labels: mdLabels }, i));
				} else if (b.type === "reasoning") {
					if (!b.text) continue;
					out.push(jsx(ArchReasoning, { text: b.text, t }, i));
				} else if (b.type === "tool-call") {
					out.push(jsx(ArchCommand, {
						name: b.name,
						args: b.arguments,
						summary: t("viewer.command.done"),
						t
					}, i));
				} else if (b.type === "tool-result") {
					const resultText = blockText(b.content);
					if (!resultText && !b.isError) continue;
					out.push(jsx(ArchCommand, {
						name: t("viewer.result"),
						args: resultText || (b.isError ? t("viewer.command.failed") : ""),
						summary: b.isError
							? t("viewer.command.failed")
							: firstLine(resultText) || t("viewer.command.done"),
						isError: b.isError,
						t
					}, i));
				}
			}
			if (error) out.push(jsx("div", { className: "dsh-arch-err-line", children: error }, "error"));
			return jsx("div", {
				className: "dsh-arch-aroot",
				children: jsx("div", { className: "dsh-arch-abody", children: out })
			});
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

		/**
		 * Shared selection state between the sidebar group and the main panel.
		 * The sidebar row writes it and activates the `archived` panel; the
		 * panel reflects it live through the subscription below.
		 */
		const archState = { viewing: null, listeners: new Set() };
		function setArchViewing(s) {
			archState.viewing = s;
			for (const fn of archState.listeners) fn(s);
		}
		function subscribeArchViewing(fn) {
			archState.listeners.add(fn);
			return () => archState.listeners.delete(fn);
		}

		// Filled in apply(); the sidebar group (not a slot component) needs the
		// layout controller and a bound locale function.
		let layoutCtl = null;
		let localeT = null;

		/** Permanently delete an archived session from both surfaces. */
		async function removeArchived(sessionId, cwd, refresh) {
			const desktop = window.__desktop__;
			if (desktop && desktop.hardDeleteSession) await desktop.hardDeleteSession(sessionId, cwd);
			// If the deleted session is the one the viewer has open, drop it too.
			if (archState.viewing && archState.viewing.sessionId === sessionId) setArchViewing(null);
			refresh();
		}

		/** Read-only transcript of one archived session. */
		function ArchivedViewer({ sessionId, title, t }) {
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
							const role = evt.kind === "user-message" ? "user" : "assistant";
							if (role === "user") {
								// A user message is its text; skip stray empty ones.
								if (!blockText(blocks).trim()) continue;
							} else if (!hasRenderable(blocks) && !evt.error) {
								continue;
							}
							msgs.push({ role, blocks, time: evt.time, error: evt.error });
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
			else body = state.messages.map((m, i) => m.role === "user"
				? jsx(ArchUserMessage, { blocks: m.blocks, time: m.time, t }, i)
				: jsxs("div", {
					className: "dsh-arch-arow",
					children: [
						jsx(ArchAssistantBody, { blocks: m.blocks, mdLabels, error: m.error, t }),
						jsx(ArchActions, { text: blockText(m.blocks), time: m.time, align: "assistant", t })
					]
				}, i));

			return jsxs("div", {
				className: "dsh-arch-view",
				children: [
					jsxs("div", {
						className: "dsh-arch-view-head",
						children: [
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

		/**
		 * The archived-sessions main panel: the list (fallback / panel entry),
		 * or one session's transcript when a row is selected from the sidebar
		 * group.
		 */
		function ArchivedPanel({ t }) {
			const [sessions, setSessions] = react.useState([]);
			const [viewing, setViewing] = react.useState(archState.viewing);
			const [pendingDelete, setPendingDelete] = react.useState(null);
			const [now, setNow] = react.useState(() => Date.now());

			// A selection made in the sidebar group updates this panel live.
			react.useEffect(() => subscribeArchViewing((v) => setViewing(v)), []);

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
					t
				});
			}

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
								onOpen: () => setArchViewing({ sessionId: s.sessionId, title: s.title }),
								onAskDelete: () => setPendingDelete(s.sessionId),
								onConfirmDelete: () => { setPendingDelete(null); void removeArchived(s.sessionId, s.cwd, refresh); },
								onCancelDelete: () => setPendingDelete(null)
							}, s.sessionId))
					}),
				]
			});
		}

		/**
		 * Archive section pinned into the sidebar, below the workspace browser.
		 * The header shows the official archive icon; rows below it are plain
		 * titles. `rail` true renders a single affordance instead (the column is
		 * too narrow for a list).
		 */
		function ArchiveSidebarGroup({ rail }) {
			const [sessions, setSessions] = react.useState([]);
			const [open, setOpen] = react.useState(true);
			const [pendingDelete, setPendingDelete] = react.useState(null);
			const [now, setNow] = react.useState(() => Date.now());
			const t = localeT;

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

			// No archived sessions: hide the group entirely (both rail and expanded).
			if (sessions.length === 0) return null;

			// Rail: one affordance that asks the shell to expand the column.
			if (rail) {
				return jsx("div", {
					className: "dsh-arch-rail",
					children: jsx("button", {
						type: "button",
						className: "dsh-arch-rail-btn",
						title: t("sidebar.label"),
						"aria-label": t("sidebar.label"),
						onClick: () => { if (layoutCtl) layoutCtl.toggleSidebar(); },
						children: jsx(primitives.IconArchiveOutline20, { size: 18 })
					})
				});
			}

			const openViewer = (s) => {
				setArchViewing({ sessionId: s.sessionId, title: s.title });
				// selectPanel throws if the `archived` panel isn't registered yet
				// (ui-layout may activate after this plugin); a transient miss just
				// leaves the viewer to be shown next time the panel is opened.
				try { if (layoutCtl) layoutCtl.selectPanel("archived"); } catch { /* panel not ready */ }
			};

			return jsxs("div", {
				className: "dsh-arch-sidebar",
				children: [
					jsxs("button", {
						type: "button",
						className: "dsh-arch-sidebar-head" + (open ? " is-open" : ""),
						"aria-expanded": open,
						title: t("sidebar.label"),
						onClick: () => setOpen((v) => !v),
						children: [
							jsx("span", { className: "dsh-arch-sidebar-icon", "aria-hidden": "true", children: jsx(primitives.IconArchiveOutline20, { size: 16 }) }),
							jsx("span", { className: "dsh-arch-sidebar-label", children: t("sidebar.label") }),
							jsx("span", { className: "dsh-arch-sidebar-count", children: sessions.length }),
							jsx("span", { className: "dsh-arch-sidebar-chevron", "aria-hidden": "true", children: jsx(primitives.IconTriangleRightFill14, {}) }),
						]
					}),
					open && jsx("div", {
						className: "dsh-arch-sidebar-list",
						children: sessions.map((s) => jsx(ArchivedRow, {
							session: s,
							now,
							t,
							confirming: pendingDelete === s.sessionId,
							onOpen: () => openViewer(s),
							onAskDelete: () => setPendingDelete(s.sessionId),
							onConfirmDelete: () => { setPendingDelete(null); void removeArchived(s.sessionId, s.cwd, refresh); },
							onCancelDelete: () => setPendingDelete(null)
						}, s.sessionId))
					}),
				]
			});
		}

		/**
		 * Host for the archive group. The shell has no slot below the workspace
		 * browser, so this component rides `sidebar.footer.action` — invisible
		 * there — and portals the group into the regionArea that holds the
		 * workspace, pinning it below the list. Region is located structurally:
		 * it is the `overflow:hidden` flex container immediately above the footer
		 * area where this marker lives (version-tolerant, no hashed classes).
		 */
		function ArchiveSidebarHost({ wide }) {
			const [region, setRegion] = react.useState(null);

			react.useLayoutEffect(() => {
				if (region) return; // anchored once; the node is stable across shell re-renders
				const host = document.querySelector('[data-hd-arch-host="1"]');
				if (!host) return;
				let el = host;
				let area = null;
				while (el) {
					const prev = el.previousElementSibling;
					if (prev && getComputedStyle(prev).overflow === 'hidden') { area = prev; break; }
					el = el.parentElement;
				}
				if (area) setRegion(area);
			}, [region]);

			return jsxs(Fragment, {
				children: [
					jsx("span", {
						"data-hd-arch-host": "1",
						"aria-hidden": "true",
						style: { display: "none" }
					}),
					region ? react_dom.createPortal(
						jsx(ArchiveSidebarGroup, { rail: !wide }),
						region
					) : null,
				]
			});
		}

		const PANEL_ID = "archived";
		const NS = "desktopArchived";

		/** Simplified Chinese dictionary (the key-set source of truth). */
		const zh = {
			"panel.title": "归档会话",
			"panel.empty": "暂无归档会话",
			"session.fallback": "归档会话",
			"sidebar.label": "归档",
			"viewer.readonly": "只读",
			"viewer.loading": "加载中…",
			"viewer.empty": "无消息记录",
			"viewer.copy": "复制",
			"viewer.think": "思考",
			"viewer.command": "工具",
			"viewer.command.done": "已完成",
			"viewer.command.failed": "指令失败",
			"viewer.result": "结果",
			"clock.md": "{m}月{d}日",
			"clock.ymd": "{y}年{m}月{d}日",
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
			"viewer.readonly": "Read-only",
			"viewer.loading": "Loading…",
			"viewer.empty": "No messages",
			"viewer.copy": "Copy",
			"viewer.think": "Think",
			"viewer.command": "Tool",
			"viewer.command.done": "Completed",
			"viewer.command.failed": "Command failed",
			"viewer.result": "Result",
			"clock.md": "{m}/{d}",
			"clock.ymd": "{y}/{m}/{d}",
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
			localeT = ctx.locale.bind(NS);
			layoutCtl = ctx.layout;
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "desktop-archived: dictionaries");

			// The archive LIST lives in the sidebar group (footer-hosted portal
			// into the workspace region), so no top-of-sidebar panellist icon is
			// registered — the old icon slot was folded into the group itself.
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: PANEL_ID
			}, ArchiveSidebarHost));

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
