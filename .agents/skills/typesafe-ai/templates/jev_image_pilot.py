#!/usr/bin/env python
# Jev image pilot: send ONE local image and ask Choice + Noul + Box in real time.
# Usage: python jev_image_pilot.py <image> [model]
# Requires: pip install "typesafe-sdk[pil]" ; TYPESAFE_API_KEY in the environment.

import os
import sys
from pathlib import Path

from PIL import Image as PILImage
from typesafe_sdk import Box, Choice, Image, Noul, TypeSafeClient

MIN_SIDE = 280  # API rejects any side below 280 px
PAD_SIZE = 512  # pad smaller images onto a larger canvas


def prepare(path: str) -> Path:
    src = Path(path)
    img = PILImage.open(src)
    w, h = img.size
    if min(w, h) >= MIN_SIDE:
        return src
    canvas = PILImage.new("RGB", (PAD_SIZE, PAD_SIZE), (255, 255, 255))
    img = img.convert("RGBA")
    canvas.paste(img, ((PAD_SIZE - w) // 2, (PAD_SIZE - h) // 2), img)
    out = src.with_name(src.stem + "-padded.png")
    canvas.save(out, "PNG")
    print(f"padded {img.size} -> {out}")
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("usage: python jev_image_pilot.py <image> [model]")
    model = sys.argv[2] if len(sys.argv) > 2 else "jev-1.14.0"
    icon_path = prepare(sys.argv[1])

    with TypeSafeClient(
        model=model,
        headers={"TypeSafe-Danger-Zone-Images": "true"},
        timeout=60,
        retry=None,
    ) as client:
        resp = client.system_one(
            state={"image": Image(icon_path)},
            questions={
                "classify": Choice(
                    instructions="Classify what the main subject of `image` is.",
                    criteria={
                        "option_a": "Describes option a.",
                        "option_b": "Describes option b.",
                        "other": "None of the options fits.",
                    },
                ),
                "has_subject": Noul(
                    instructions="Is there a clearly identifiable subject in `image`?"
                ),
                "locate": Box(instructions="the main subject in `image`"),
            },
        )

    print("== RESPOSTAS ==")
    for qid, ans in resp.answers.items():
        print(qid, "->", ans)
    print("== usage ==", resp.usage)


if __name__ == "__main__":
    if not os.environ.get("TYPESAFE_API_KEY"):
        sys.exit("TYPESAFE_API_KEY nao definida no ambiente.")
    main()
