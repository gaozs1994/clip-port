from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
SIZE = 512
SCALE = 4
CANVAS = SIZE * SCALE


def scaled_box(values):
    return tuple(round(value * SCALE) for value in values)


def polygon(draw, points, **kwargs):
    draw.polygon([(round(x * SCALE), round(y * SCALE)) for x, y in points], **kwargs)


def line(draw, points, **kwargs):
    draw.line([(round(x * SCALE), round(y * SCALE)) for x, y in points], **kwargs)


def vertical_gradient(size, top, bottom):
    image = Image.new("RGB", (size, size), top)
    draw = ImageDraw.Draw(image)
    for y in range(size):
        ratio = y / max(1, size - 1)
        color = tuple(round(a + (b - a) * ratio) for a, b in zip(top, bottom))
        draw.line((0, y, size, y), fill=color)
    return image.convert("RGBA")


def glow_arc(base, box, start, end, color, width, blur):
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.arc(box, start=start, end=end, fill=color, width=width)
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(blur)))


def glow_polygon(base, points, color, blur):
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    polygon(ImageDraw.Draw(glow), points, fill=color)
    base.alpha_composite(glow.filter(ImageFilter.GaussianBlur(blur)))


def main():
    BUILD.mkdir(parents=True, exist_ok=True)
    image = vertical_gradient(CANVAS, (7, 12, 23), (23, 8, 31))

    grid = Image.new("RGBA", image.size, (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid)
    grid_color = (55, 234, 247, 12)
    for coordinate in range(32, SIZE, 32):
        offset = round(coordinate * SCALE)
        grid_draw.line((offset, 0, offset, CANVAS), fill=grid_color, width=SCALE)
        grid_draw.line((0, offset, CANVAS, offset), fill=grid_color, width=SCALE)
    image.alpha_composite(grid)

    frame = [(106, 38), (406, 38), (474, 106), (474, 406), (406, 474), (106, 474), (38, 406), (38, 106), (106, 38)]
    frame_layer = Image.new("RGBA", image.size, (0, 0, 0, 0))
    line(ImageDraw.Draw(frame_layer), frame, fill=(50, 234, 242, 88), width=4 * SCALE, joint="curve")
    image.alpha_composite(frame_layer)
    draw = ImageDraw.Draw(image)
    line(draw, [(106, 38), (202, 38)], fill=(255, 44, 168, 255), width=7 * SCALE)
    line(draw, [(310, 474), (406, 474), (474, 406), (474, 316)], fill=(255, 44, 168, 255), width=7 * SCALE)
    line(draw, [(38, 174), (38, 106), (106, 38), (158, 38)], fill=(88, 247, 255, 255), width=7 * SCALE)

    arc_box = scaled_box((96, 96, 416, 416))
    glow_arc(image, arc_box, 45, 315, (255, 44, 168, 130), 70 * SCALE, 18 * SCALE)
    glow_arc(image, arc_box, 45, 315, (42, 229, 249, 170), 62 * SCALE, 10 * SCALE)
    draw = ImageDraw.Draw(image)
    draw.arc(arc_box, start=45, end=315, fill=(37, 229, 246, 255), width=58 * SCALE)
    draw.arc(arc_box, start=45, end=210, fill=(89, 247, 255, 255), width=58 * SCALE)
    draw.arc(arc_box, start=210, end=315, fill=(89, 112, 255, 255), width=58 * SCALE)

    play = [(224, 184), (350, 256), (224, 328)]
    glow_polygon(image, play, (255, 44, 168, 180), 16 * SCALE)
    draw = ImageDraw.Draw(image)
    polygon(draw, play, fill=(255, 39, 137, 255))
    polygon(draw, [(245, 221), (306, 256), (245, 291)], fill=(9, 16, 29, 245))

    line(draw, [(384, 210), (444, 210)], fill=(255, 44, 168, 255), width=8 * SCALE)
    line(draw, [(397, 256), (462, 256)], fill=(88, 247, 255, 255), width=8 * SCALE)
    line(draw, [(384, 302), (444, 302)], fill=(255, 44, 168, 255), width=8 * SCALE)

    draw.rectangle(scaled_box((70, 70, 83, 83)), fill=(88, 247, 255, 255))
    draw.rectangle(scaled_box((92, 70, 124, 83)), fill=(88, 247, 255, 255))
    draw.rectangle(scaled_box((388, 429, 401, 442)), fill=(255, 44, 168, 255))
    draw.rectangle(scaled_box((410, 429, 442, 442)), fill=(255, 44, 168, 255))

    result = image.convert("RGB").resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    result.save(BUILD / "icon.png", format="PNG", optimize=True)
    result.save(
        BUILD / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
