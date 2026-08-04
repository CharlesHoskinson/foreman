# Total Georgecall Release Presentation Design

## Purpose

Correct the presentation of the Foreman v0.2.9.0 release. The release name is
`Total Georgecall`. The release notes must show the approved release artwork.

## Scope

- Keep `v0.2.9.0` as the Git tag and technical version.
- Set the GitHub release title to `Total Georgecall`.
- Set `Total Georgecall` as the primary heading in the tracked release notes.
- Put `Foreman v0.2.9.0` directly below the primary heading.
- Put the approved artwork directly below the version text.
- Use the image at `assets/v029-total-georgecall.png`.
- Use a URL that resolves through the immutable `v0.2.9.0` tag.

## Data Flow

The tracked release notes are the source for the published GitHub release body.
The published body loads the image from the tagged repository content. The
release title is GitHub metadata and does not change the Git tag.

## Integrity

The tracked image and the supplied image have the same SHA-256 digest:

`7ad8eaf4f593bdf108ef9e0a64ee965617b06a1a99469f1103d0b94cf2c118fa`

The `v0.2.9.0` tag contains the tracked image. This change must not move the tag
or change the existing release evidence assets.

## Validation

- Confirm that Markdownlint passes.
- Confirm that the image URL returns the tagged image.
- Confirm that the tracked release notes contain the title and image.
- Confirm that the published release title is `Total Georgecall`.
- Confirm that the published release body contains the tag-pinned image URL.
- Confirm that the `v0.2.9.0` tag still resolves to `fbe2325`.
