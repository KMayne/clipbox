# HEIC fixtures

Made for this project by `make.py` (ffmpeg's libx265 encodes each image as one HEVC intra frame;
the script writes the HEIF container), so there's no third-party licence. Flat colours, so the
tests can check pixels.

- `halves.heic`: one 64 × 48 image, red left half, blue right half.
- `burst.heic`: three top-level images (64 × 48 red, primary; 32 × 32 green; 16 × 24 blue).

Regenerate with `python3 -I tests/fixtures/heic/make.py` (needs ffmpeg built with libx265).
