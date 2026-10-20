# 0008: Repository workspace layout

- **Status:** Accepted
- **Date:** 2026-10-20

## Context

Repository pages used the marketing site's frame: its header ("Features / How it works / Demos"), its footer, and a centred `max-w-6xl` column under a back link, a demo banner, the repository title and a row of seven tabs. On a 1440px screen about a quarter of the width was empty and the first ~190px held no content. Chat was the last tab, so following a citation meant leaving the answer.

## Decision

**Two shells, same URLs.** Route groups split the app: `app/(site)/` (landing, login, register, eval, the repository list) keeps the marketing header and footer; `app/(workspace)/repos/[snapshotId]/` has its own frame. The root layout holds only `<html>`, the theme script and fonts.

**An IDE-style frame on wider screens.** From `md` up, the workspace fills the window: a 56px top bar (repository, status and commit, ⌘K search, the chat toggle, theme, account), a section sidebar that collapses to icons, the section itself, and the chat panel. Each column scrolls on its own. Phones keep one scrolling page with the existing section tabs, Chat included.

**Chat docks beside every section.** The panel lives in the workspace layout, which stays mounted while the visitor moves between sections, so a draft or a streaming answer survives navigation and a citation opens in the main area with the answer still visible. Whether it is open and which conversation it shows are kept in `sessionStorage` (per tab, with an in-memory fallback). Conversations load the first time it opens, so visitors who never open it cost no requests. `/chat` stays as the full-page chat for phones and deep links; the panel and its toggle are hidden there.

**Layouts follow the space, not the screen.** The main area is a CSS container. Section grids use container-query breakpoints (`@2xl`, `@3xl`, `@5xl`, `@6xl`) instead of viewport ones, so opening the chat panel moves the code viewer's references under the code rather than squeezing three columns.

**Visual identity unchanged.** Palette, type and components are as before; this is a layout change.

## Consequences

- Section components assume they sit inside the workspace's container; used elsewhere, their grids would stay single-column.
- Sticky elements inside the main area stick to its scroll container, not the window.
- The chat panel takes 26rem; below roughly 1100px of window width, wide sections get tight with it open. It is closed by default.
