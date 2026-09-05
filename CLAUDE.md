# Agent Instructions

## Communication

- Use English for all documentation and code comments.
- Keep responses concise and actionable.
- Challenge proposals when you have a better alternative.
- **Explain Simpler (Product Owner Perspective)**: Default to explaining issues, fixes, and features as if speaking to a non-technical Product Owner.
  - Lead with user experience and product impact (what was broken or what capability was added).
  - Explain technical causes using clear real-world analogies (e.g. "website bot guard" instead of "TLS fingerprint mismatch").
  - Focus on outcomes, user workflows, and product capabilities rather than low-level code mechanics unless explicitly asked for technical implementation details.

## Project Context

- This project is an open-source, lightweight RSS reader, webpage monitor, and aggregator.
- Prioritize simplicity and maintainability over complexity.

## Code Standards

- Follow best practices without over-engineering.
- Default to no backward-compatibility work unless explicitly requested; if a change may break data formats, public APIs, or migrations, clearly state the impact.
- Write self-explanatory code with clear naming.
- Add comments in English only when they provide non-obvious value:
  - **DO write comments for:**
    - Complex business logic or algorithms
    - Non-obvious design decisions and trade-offs
    - Public APIs, exported functions, and package documentation
    - TODO/FIXME/NOTE markers with context
  - **DON'T write comments for:**
    - Self-evident code (e.g., getters/setters)
    - Repeating what the code already says
    - Implementation details that naming makes clear

## Go Development

- After modifying Go code, run `goimports -w .` before verification.
- Verify compilation with `go build -o /dev/null /path/to/file_or_dir`.
- Run related tests and ensure they pass.
- Use named SQL parameters (e.g., `:param_name` or `@param_name`).

## Frontend Development

- Verify TypeScript/TSX compilation with `npx tsc -b --noEmit`.
- shadcn components use Base UI (`@base-ui/react`) on the `base-vega` style. Regenerate via CLI (`pnpm dlx shadcn@latest add <component> --overwrite`) instead of hand-editing source files in `frontend/src/components/ui/`.

## Dev-to-Dist Release Workflow

- Do **NOT** automatically build the standalone app after routine code changes. Only build when explicitly instructed by the user.
- Whenever requested to build or update the standalone macOS desktop app (`Scout.app`), execute `./scripts/build-macos-app.sh`.
- Always verify frontend build sync (`rm -rf backend/internal/web/dist && cp -R frontend/dist/. backend/internal/web/dist/`).
- Running `./scripts/build-macos-app.sh` builds into `dist/`. Do **NOT** automatically replace or copy into `/Applications/Scout.app` (which is kept separate) unless explicitly instructed to do so.
- Ensure React Query caches and unread counters (`queryKeys.feeds.all`, `queryKeys.focusFeeds.all`, `queryKeys.items.all`) are properly invalidated upon read/unread mutations.
