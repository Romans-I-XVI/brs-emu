import { BrsValue, ValueKind, BrsString, BrsInvalid, BrsBoolean } from "../BrsType";
import { BrsComponent } from "./BrsComponent";
import { BrsType } from "..";
import { Callable, StdlibArgument } from "../Callable";
import { Interpreter } from "../../interpreter";
import { Int32 } from "../Int32";
import { Float } from "../Float";
import { RoRegion } from "./RoRegion";
import { RoFont } from "./RoFont";
import { RoAssociativeArray } from "./RoAssociativeArray";
import URL from "url-parse";
import { RoByteArray } from "./RoByteArray";
import * as PNG from "fast-png";

export class RoBitmap extends BrsComponent implements BrsValue {
    readonly kind = ValueKind.Object;
    private alphaEnable: boolean;
    private canvas: OffscreenCanvas;
    private context: OffscreenCanvasRenderingContext2D;
    private valid: boolean;

    constructor(interpreter: Interpreter, param: BrsComponent) {
        super("roBitmap", ["ifDraw2D"]);
        let width = 300;
        let height = 150;
        let image;
        this.alphaEnable = false;
        this.valid = true;
        if (param instanceof BrsString) {
            let url = new URL(param.value);
            const volume = interpreter.fileSystem.get(url.protocol);
            if (volume) {
                try {
                    image = volume.readFileSync(url.pathname);
                    this.alphaEnable = true;
                } catch (err) {
                    console.error("Error loading bitmap:" + url.pathname + " - " + err.message);
                    this.valid = false;
                }
            } else {
                console.error("Invalid volume:" + url.pathname);
                this.valid = false;
            }
        } else if (param instanceof RoAssociativeArray) {
            let paramWidth = param.get(new BrsString("width"));
            if (paramWidth instanceof Int32 || paramWidth instanceof Float) {
                width = paramWidth.getValue();
            }
            let paramHeight = param.get(new BrsString("height"));
            if (paramHeight instanceof Int32 || paramHeight instanceof Float) {
                height = paramHeight.getValue();
            }
            let alphaEnable = param.get(new BrsString("alphaEnable"));
            if (alphaEnable instanceof BrsBoolean) {
                this.alphaEnable = alphaEnable.toBoolean();
            }
        } else {
            console.error("Invalid roBitmap param:", param);
            this.valid = false;
        }
        this.canvas = new OffscreenCanvas(width, height);
        //TODO: Review alpha enable, it should only affect bitmap as destination.
        this.context = this.canvas.getContext("2d", {
            alpha: this.alphaEnable,
        }) as OffscreenCanvasRenderingContext2D;
        if (image) {
            try {
                if (image instanceof Uint8Array) {
                    let png = PNG.decode(image);
                    let imageData = this.context.createImageData(png.width, png.height);
                    this.canvas.width = png.width;
                    this.canvas.height = png.height;
                    imageData.data.set(png.data);
                    this.context.putImageData(imageData, 0, 0);
                } else if (image instanceof ImageBitmap) {
                    this.canvas.width = image.width;
                    this.canvas.height = image.height;
                    this.context.drawImage(image, 0, 0);
                } else {
                    console.error("Invalid file format!", image);
                    this.valid = false;
                }
            } catch (err) {
                console.error("Error drawing image on canvas! " + err.message);
                this.valid = false;
            }
        }

        this.registerMethods([
            this.clear,
            this.drawObject,
            this.drawRotatedObject,
            this.drawScaledObject,
            this.drawLine,
            this.drawPoint,
            this.drawRect,
            this.drawText,
            this.finish,
            this.getAlphaEnable,
            this.setAlphaEnable,
            this.getByteArray,
            this.getPng,
            this.getWidth,
            this.getHeight,
        ]);
    }

    clearCanvas(rgba: number) {
        let ctx = this.context;
        ctx.fillStyle = rgbaIntToHex(rgba);
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        return BrsInvalid.Instance;
    }

    drawImage(image: OffscreenCanvas, x: number, y: number) {
        this.context.drawImage(image, x, y);
    }

    getCanvas(): OffscreenCanvas {
        return this.canvas;
    }

    getContext(): OffscreenCanvasRenderingContext2D {
        return this.context;
    }

    setCanvasAlpha(enable: boolean) {
        this.alphaEnable = enable;
        let context = this.canvas.getContext("2d", {
            alpha: this.alphaEnable,
        }) as OffscreenCanvasRenderingContext2D;
        this.context = context;
        return BrsInvalid.Instance;
    }

    toString(parent?: BrsType): string {
        return "<Component: roBitmap>";
    }

    equalTo(other: BrsType) {
        return BrsBoolean.False;
    }

    isValid() {
        return this.valid;
    }

    // ifDraw2D  -----------------------------------------------------------------------------------

    /** Clear the bitmap, and fill with the specified RGBA color */
    private clear = new Callable("clear", {
        signature: {
            args: [new StdlibArgument("rgba", ValueKind.Int32)],
            returns: ValueKind.Void,
        },
        impl: (_: Interpreter, rgba: Int32) => {
            return this.clearCanvas(rgba.getValue());
        },
    });

    /** Draw the source object, where src is an roBitmap or an roRegion object, at position x,y */
    private drawObject = new Callable("drawObject", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("object", ValueKind.Object),
                new StdlibArgument("rgba", ValueKind.Object, BrsInvalid.Instance),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (
            _: Interpreter,
            x: Int32,
            y: Int32,
            object: BrsComponent,
            rgba: Int32 | BrsInvalid
        ) => {
            let result = BrsBoolean.True;
            if (object instanceof RoBitmap) {
                this.drawImage(object.getCanvas(), x.getValue(), y.getValue());
            } else if (object instanceof RoRegion) {
                let ctx = this.context;
                ctx.drawImage(
                    object.getCanvas(),
                    object.getPosX(),
                    object.getPosY(),
                    object.getImageWidth(),
                    object.getImageHeight(),
                    x.getValue() + object.getTransX(),
                    y.getValue() + object.getTransY(),
                    object.getImageWidth(),
                    object.getImageHeight()
                );
            } else {
                result = BrsBoolean.False;
            }
            return result;
        },
    });

    /** Draw the source object at position x,y rotated by angle theta degrees. */
    private drawRotatedObject = new Callable("drawRotatedObject", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("theta", ValueKind.Float),
                new StdlibArgument("object", ValueKind.Object), // TODO: Add support to roRegion
            ],
            returns: ValueKind.Boolean,
        },
        impl: (_: Interpreter, x: Int32, y: Int32, theta: Float, object: RoBitmap) => {
            let ctx = this.context;
            let obj = object.getCanvas();
            let positionX = x.getValue();
            let positionY = y.getValue();
            let angleInRad = (-theta.getValue() * Math.PI) / 180;
            let width = obj.width;
            let height = obj.height;

            ctx.translate(positionX, positionY);
            ctx.rotate(angleInRad);
            ctx.drawImage(obj, 0, 0, width, height);
            ctx.rotate(-angleInRad);
            ctx.translate(-positionX, -positionY);

            return BrsBoolean.True;
        },
    });

    /** Draw the source object, at position x,y, scaled horizotally by scaleX and vertically by scaleY. */
    private drawScaledObject = new Callable("drawScaledObject", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("scaleX", ValueKind.Float),
                new StdlibArgument("scaleY", ValueKind.Float),
                new StdlibArgument("object", ValueKind.Object),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (
            _: Interpreter,
            x: Int32,
            y: Int32,
            scaleX: Float,
            scaleY: Float,
            object: BrsComponent
        ) => {
            let result = BrsBoolean.True;
            let ctx = this.context;
            ctx.imageSmoothingEnabled = false;
            if (object instanceof RoBitmap) {
                let cvs = object.getCanvas();
                ctx.drawImage(
                    cvs,
                    x.getValue(),
                    y.getValue(),
                    cvs.width * scaleX.getValue(),
                    cvs.height * scaleY.getValue()
                );
            } else if (object instanceof RoRegion) {
                let cvs = object.getCanvas();
                let tx = object.getTransX() * scaleX.getValue();
                let ty = object.getTransY() * scaleY.getValue();
                ctx.drawImage(
                    cvs,
                    object.getPosX(),
                    object.getPosY(),
                    object.getImageWidth(),
                    object.getImageHeight(),
                    x.getValue() + tx,
                    y.getValue() + ty,
                    object.getImageWidth() * scaleX.getValue(),
                    object.getImageHeight() * scaleY.getValue()
                );
            } else {
                result = BrsBoolean.False;
            }
            return result;
        },
    });

    /** Draw a line from (xStart, yStart) to (xEnd, yEnd) with RGBA color */
    private drawLine = new Callable("drawLine", {
        signature: {
            args: [
                new StdlibArgument("xStart", ValueKind.Int32),
                new StdlibArgument("yStart", ValueKind.Int32),
                new StdlibArgument("xEnd", ValueKind.Int32),
                new StdlibArgument("yEnd", ValueKind.Int32),
                new StdlibArgument("rgba", ValueKind.Int32),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (
            _: Interpreter,
            xStart: Int32,
            yStart: Int32,
            xEnd: Int32,
            yEnd: Int32,
            rgba: Int32
        ) => {
            let ctx = this.context;
            ctx.beginPath();
            ctx.strokeStyle = rgbaIntToHex(rgba.getValue());
            ctx.moveTo(xStart.getValue(), yStart.getValue());
            ctx.lineTo(xEnd.getValue(), yEnd.getValue());
            ctx.stroke();
            return BrsBoolean.True;
        },
    });

    /** Draws a point at (x,y) with the given size and RGBA color */
    private drawPoint = new Callable("drawPoint", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("size", ValueKind.Float),
                new StdlibArgument("rgba", ValueKind.Int32),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (_: Interpreter, x: Int32, y: Int32, size: Float, rgba: Int32) => {
            let ctx = this.context;
            ctx.fillStyle = rgbaIntToHex(rgba.getValue());
            ctx.fillRect(x.getValue(), y.getValue(), size.getValue(), size.getValue());
            return BrsBoolean.True;
        },
    });

    /** Fill the specified rectangle from left (x), top (y) to right (x + width), bottom (y + height) with the RGBA color */
    private drawRect = new Callable("drawRect", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("width", ValueKind.Int32),
                new StdlibArgument("height", ValueKind.Int32),
                new StdlibArgument("rgba", ValueKind.Int32),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (_: Interpreter, x: Int32, y: Int32, width: Int32, height: Int32, rgba: Int32) => {
            let ctx = this.context;
            ctx.fillStyle = rgbaIntToHex(rgba.getValue());
            ctx.fillRect(x.getValue(), y.getValue(), width.getValue(), height.getValue());
            return BrsBoolean.True;
        },
    });

    /** Draws the text at position (x,y) using the specified RGBA color and roFont font object. */
    private drawText = new Callable("drawText", {
        signature: {
            args: [
                new StdlibArgument("text", ValueKind.String),
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("rgba", ValueKind.Int32),
                new StdlibArgument("font", ValueKind.Object),
            ],
            returns: ValueKind.Boolean,
        },
        impl: (_: Interpreter, text: BrsString, x: Int32, y: Int32, rgba: Int32, font: RoFont) => {
            let ctx = this.context;
            ctx.fillStyle = rgbaIntToHex(rgba.getValue());
            ctx.font = font.toFontString();
            ctx.textBaseline = "top";
            ctx.fillText(text.toString(), x.getValue(), y.getValue() + 3);
            return BrsBoolean.True;
        },
    });

    /** Realize the bitmap by finishing all queued draw calls. */
    private finish = new Callable("finish", {
        signature: {
            args: [],
            returns: ValueKind.Void,
        },
        impl: (_: Interpreter) => {
            return BrsInvalid.Instance;
        },
    });

    /** Returns true if alpha blending is enabled */
    private getAlphaEnable = new Callable("getAlphaEnable", {
        signature: {
            args: [],
            returns: ValueKind.Boolean,
        },
        impl: (_: Interpreter) => {
            return BrsBoolean.from(this.alphaEnable);
        },
    });

    /** If enable is true, do alpha blending when this bitmap is the destination */
    private setAlphaEnable = new Callable("setAlphaEnable", {
        signature: {
            args: [new StdlibArgument("alphaEnabled", ValueKind.Boolean)],
            returns: ValueKind.Void,
        },
        impl: (_: Interpreter, alphaEnabled: BrsBoolean) => {
            return this.setCanvasAlpha(alphaEnabled.toBoolean());
        },
    });

    /** Return the width of the screen/bitmap/region. */
    private getWidth = new Callable("getWidth", {
        signature: {
            args: [],
            returns: ValueKind.Int32,
        },
        impl: (_: Interpreter) => {
            return new Int32(this.canvas.width);
        },
    });

    /** Return the height of the screen/bitmap/region. */
    private getHeight = new Callable("getHeight", {
        signature: {
            args: [],
            returns: ValueKind.Int32,
        },
        impl: (_: Interpreter) => {
            return new Int32(this.canvas.height);
        },
    });

    /** Returns an roByteArray representing the RGBA pixel values for the rectangle described by the parameters. */
    private getByteArray = new Callable("getByteArray", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("width", ValueKind.Int32),
                new StdlibArgument("height", ValueKind.Int32),
            ],
            returns: ValueKind.Int32,
        },
        impl: (_: Interpreter, x: Int32, y: Int32, width: Int32, height: Int32) => {
            let imgData = this.context.getImageData(
                x.getValue(),
                y.getValue(),
                width.getValue(),
                height.getValue()
            );
            let byteArray = new Uint8Array(imgData.data.buffer);
            return new RoByteArray(byteArray);
        },
    });

    /** Returns an roByteArray object containing PNG image data for the specified area of the bitmap. */
    private getPng = new Callable("getPng", {
        signature: {
            args: [
                new StdlibArgument("x", ValueKind.Int32),
                new StdlibArgument("y", ValueKind.Int32),
                new StdlibArgument("width", ValueKind.Int32),
                new StdlibArgument("height", ValueKind.Int32),
            ],
            returns: ValueKind.Int32,
        },
        impl: (_: Interpreter, x: Int32, y: Int32, width: Int32, height: Int32) => {
            let imgData = this.context.getImageData(
                x.getValue(),
                y.getValue(),
                width.getValue(),
                height.getValue()
            );
            let idata: PNG.IImageData = {
                width: imgData.width,
                height: imgData.height,
                data: new Uint8Array(imgData.data.buffer),
                depth: 8,
                channels: 4,
            };
            return new RoByteArray(PNG.encode(idata));
        },
    });
}

export function createBitmap(interpreter: Interpreter, param: BrsComponent) {
    const bmp = new RoBitmap(interpreter, param);
    return bmp.isValid() ? bmp : BrsInvalid.Instance;
}

export function rgbaIntToHex(rgba: number): string {
    var hex = (rgba >>> 0).toString(16);
    while (hex.length < 8) {
        hex = "0" + hex;
    }
    return "#" + hex;
}
