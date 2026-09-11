# Repository Guidelines

## Project Structure & Module Organization

This repository contains a static personal academic website.
- `index.html` contains the page content, table-based layout, embedded styles, and publication entries.
- `stylesheet.css` contains additional CSS and font definitions; check how a style is applied before editing it.
- `Images/` stores profile and research images; `Figures/` contains supplementary figures and PDFs.
- `Papers/`, `CV/`, and `Awards/` contain downloadable documents.
- `README.md` links to the published website.

There is no application framework, package manifest, dedicated test directory, or configured build pipeline.

## Build, Test, and Development Commands

Run commands from the repository root:
- `python3 -m http.server 8000 --bind 127.0.0.1` serves the site locally. Open `http://127.0.0.1:8000/` and stop the server with Ctrl+C. Python 3 is required.
- `git diff --check` checks changes for whitespace errors.
- `git diff -- index.html stylesheet.css` reviews content and styling edits before committing.

No compilation or dependency installation is required.

## Coding Style & Naming Conventions

Match nearby HTML and CSS formatting. Prefer two-space indentation for new blocks; avoid reformatting unrelated legacy markup or changing line endings across entire files. Use quoted HTML attributes and meaningful image alternative text.

Follow existing publication-entry structure when adding research. Use descriptive asset names such as `kinnews_kirnews.JPG`. Preserve exact filename and directory capitalization in links, including `.JPG` versus `.png`. No formatter or linter is configured.

## Testing Guidelines

Validation is manual; no automated test framework or coverage requirement is configured. Preview changes at desktop and narrow viewport widths. Check affected text, image sizing, layout, hover behavior, and document links. Verify new local assets load and inspect browser developer tools for missing resources. Distinguish pre-existing issues from regressions.

## Commit & Pull Request Guidelines

History uses short, informal messages such as `add updated CV` and `updated info`; no enforced commit format is evident. Prefer concise, descriptive subjects identifying the change.

Keep commits focused. Pull requests should describe the change, list manual checks, link relevant issues when applicable, and include screenshots for visible layout changes. Review PDFs and images before committing to ensure they are intended for public distribution.
