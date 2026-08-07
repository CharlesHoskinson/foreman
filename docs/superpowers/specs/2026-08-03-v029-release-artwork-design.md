# Total Georgecall Release Truth Design

## Purpose

Correct the presentation and the active documentation authority for Foreman
v0.2.9.0. The release name is `Total Georgecall`. The release notes must show
the approved artwork and the complete verified release record.

## Scope

- Keep `v0.2.9.0` as the Git tag and technical version.
- Set the GitHub release title to `Total Georgecall`.
- Set `Total Georgecall` as the primary heading in the tracked release notes.
- Put `Foreman v0.2.9.0` directly below the primary heading.
- Put the approved artwork directly below the version text.
- Use the image at `assets/v029-total-georgecall.png`.
- Use a URL that resolves through the immutable `v0.2.9.0` tag.
- Add one canonical accomplishment ledger for v0.2.8.2 and v0.2.9.0.
- Expand the v0.2.9.0 notes from the verified ledger and exact release evidence.
- Add a current release summary and links to `README.md`.
- Mark v0.2.9.0 as the latest release in `ROADMAP.md`.
- Convert `checklist.md` from a provisional checklist to a completed release record.
- Keep incomplete work separate as v0.3.0 input. Do not present it as v0.2.9.0 scope.

## Data Flow

The canonical accomplishment ledger records exact shipped work, verification,
cleanup, and explicit limits. The tracked release notes summarize that ledger.
The README and roadmap link to the ledger and release notes. The tracked release
notes are the source for the published GitHub release body.

The published body loads the image from the tagged repository content. The
release title is GitHub metadata. The metadata update does not change the Git
tag or the existing release assets.

The v0.3.0 planning package consumes the accomplishment ledger and current
residuals as required Council review inputs. A Council reviewer must request
changes when a proposed v0.3.0 specification invents completed work, loses an
unfinished item, or contradicts a recorded release boundary. A reviewer can
abstain when the supplied evidence cannot determine coverage.

## Integrity

The tracked image and the supplied image have the same SHA-256 digest:

`7ad8eaf4f593bdf108ef9e0a64ee965617b06a1a99469f1103d0b94cf2c118fa`

The `v0.2.9.0` tag contains the tracked image. This change must not move the tag
or change the existing release evidence assets.

## Validation

- Confirm that Markdownlint passes.
- Confirm that the accomplishment ledger covers both exact release records.
- Confirm that release claims cite a commit, gate, artifact, or tracked source.
- Confirm that incomplete work appears only in a limits or future-work section.
- Confirm that the image URL returns the tagged image.
- Confirm that the tracked release notes contain the title and image.
- Confirm that the README and roadmap identify v0.2.9.0 as the latest release.
- Confirm that the top-level checklist has no provisional or unchecked release action.
- Confirm that the published release title is `Total Georgecall`.
- Confirm that the published release body contains the tag-pinned image URL.
- Confirm that the `v0.2.9.0` tag still resolves to `fbe2325`.
