var display = document.getElementById("display");
var screenSize = { width: 854, height: 480 };
var ctx = display.getContext("2d", { alpha: false });
var bufferCanvas = new OffscreenCanvas(screenSize.width, screenSize.height);
var bufferCtx = bufferCanvas.getContext("2d");
var buffer = new ImageData(screenSize.width, screenSize.height);
var dirty = false;
var splashTimeout = 1600;
var brsWorker;
var source = [];
var paths = [];
var txts = [];
var imgs = [];

// Control buffer
const length = 10;
const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * length);
const sharedArray = new Int32Array(sharedBuffer);
for (let i = 0; i < length; i++) sharedArray[i] = i && sharedArray[i - 1] + 2;

// Keyboard handlers
document.addEventListener("keydown", keyDownHandler, false);
document.addEventListener("keyup", keyUpHandler, false);

// File selector
var fileSelector = document.getElementById("file");
var zip = new JSZip();

fileSelector.onclick = function() {
    this.value = null;
};
fileSelector.onchange = function() {
    var file = this.files[0];
    var reader = new FileReader();
    reader.onload = function(progressEvent) {
        source.push(this.result);
        loadAssets(file.name);
    };
    source = [];
    if (brsWorker != undefined) {
        brsWorker.terminate();
    }
    if (file.name.split(".").pop() === "zip") {
        openChannelZip(file);
    } else {
        reader.readAsText(file);
    }
};

function openChannelZip(f) {
    console.log("Loading " + f.name + "...");
    JSZip.loadAsync(f).then(
        function(zip) {
            var manifest = zip.file("manifest");
            if (manifest) {
                manifest.async("string").then(
                    function success(content) {
                        var manifestMap = new Map();
                        content.match(/[^\r\n]+/g).map(function(ln) {
                            line = ln.split("=");
                            manifestMap.set(line[0], line[1]);
                        });
                        splashMinTime = manifestMap.get("splash_min_time");
                        if (splashMinTime && !isNaN(splashMinTime)) {
                            splashTimeout = parseInt(splashMinTime);
                        }
                        var splashHD = manifestMap.get("splash_screen_hd");
                        if (splashHD && splashHD.substr(0, 5) === "pkg:/") {
                            splashFile = zip.file(splashHD.substr(5));
                            if (splashFile) {
                                splashFile.async("blob").then(blob => {
                                    createImageBitmap(blob).then(imgData => {
                                        display.style.display = "initial";
                                        ctx.drawImage(
                                            imgData,
                                            0,
                                            0,
                                            screenSize.width,
                                            screenSize.height
                                        );
                                    });
                                });
                            }
                        }
                    },
                    function error(e) {
                        console.error("Error uncompressing manifest:" + e.message);
                    }
                );
            } else {
                console.error("Invalid Roku package: missing manifest.");
                return;
            }
            var assetPaths = [];
            var assetsEvents = [];
            var bmpId = 0;
            var txtId = 0;
            var srcId = 0;
            zip.forEach(function(relativePath, zipEntry) {
                if (
                    !zipEntry.dir &&
                    relativePath.toLowerCase().substr(0, 6) === "source" &&
                    relativePath.split(".").pop() === "brs"
                ) {
                    assetPaths.push({ url: relativePath, id: srcId, type: "source" });
                    assetsEvents.push(zipEntry.async("string"));
                    srcId++;
                } else if (
                    !zipEntry.dir &&
                    (relativePath.split(".").pop() === "xml" ||
                        relativePath.split(".").pop() === "json")
                ) {
                    assetPaths.push({ url: relativePath, id: txtId, type: "text" });
                    assetsEvents.push(zipEntry.async("string"));
                    txtId++;
                } else if (
                    !zipEntry.dir &&
                    (relativePath.split(".").pop() === "png" ||
                        relativePath.split(".").pop() === "jpg")
                ) {
                    assetPaths.push({ url: relativePath, id: bmpId, type: "image" });
                    assetsEvents.push(zipEntry.async("blob"));
                    bmpId++;
                }
            });
            Promise.all(assetsEvents).then(
                function success(assets) {
                    paths = [];
                    txts = [];
                    imgs = [];
                    var bmpEvents = [];
                    for (var index = 0; index < assets.length; index++) {
                        paths.push(assetPaths[index]);
                        if (assets[index] instanceof Blob) {
                            bmpEvents.push(createImageBitmap(assets[index]));
                        } else if (assetPaths[index].type === "source") {
                            source.push(assets[index]);
                        } else {
                            txts.push(assets[index]);
                        }
                    }
                    Promise.all(bmpEvents).then(
                        function success(bmps) {
                            bmps.forEach(bmp => {
                                imgs.push(bmp);
                            });
                            setTimeout(function() {
                                runChannel();
                            }, splashTimeout);
                        },
                        function error(e) {
                            console.error("Error converting image " + e.message);
                        }
                    );
                },
                function error(e) {
                    console.error("Error uncompressing file " + e.message);
                }
            );
        },
        function(e) {
            console.error("Error reading " + f.name + ": " + e.message);
        }
    );
}

function loadAssets(fileName) {
    var loader = new Worker("app/loader.js");
    var files = [];
    files.push({ path: "images/sprite.png", type: "image/png" });
    files.push({ path: "images/roku-logo.png", type: "image/png" });
    files.push({ path: "images/AmigaBoingBall.png", type: "image/png" });
    files.push({ path: "images/BallShadow.png", type: "image/png" });
    files.push({ path: "assets/3ballset.png", type: "image/png" });
    files.push({ path: "assets/4ballset.png", type: "image/png" });
    files.push({ path: "assets/5ballset.png", type: "image/png" });
    files.push({ path: "assets/6ballset.png", type: "image/png" });
    files.push({ path: "assets/8ballset.png", type: "image/png" });
    files.push({ path: "assets/bitmapset.xml", type: "text/xml" });
    loader.onmessage = function(e) {
        paths = [];
        imgs = [];
        txts = [];
        e.data.forEach(file => {
            paths.push(file.path);
            if (file.bmp) {
                imgs.push(file.bmp);
            } else {
                txts.push(file.txt);
            }
        });
        loader.terminate();
        paths.push({ url: fileName, id: 0, type: "source" });
        runChannel();
    };
    loader.postMessage({ assets: files });
}

function runChannel() {
    ctx.fillStyle = "rgba(0, 0, 0, 1)";
    ctx.fillRect(0, 0, display.width, display.height);
    display.style.display = "initial";
    brsWorker = new Worker("./lib/brsLib.js");
    brsWorker.addEventListener("message", saveBuffer);
    var payload = { paths: paths, brs: source, texts: txts, images: imgs };
    brsWorker.postMessage(sharedBuffer);
    brsWorker.postMessage(payload, imgs);
}

function saveBuffer(event) {
    buffer = event.data;
    dirty = true;
}
function drawCanvas() {
    if (dirty) {
        bufferCanvas.width = buffer.width;
        bufferCanvas.height = buffer.height;
        bufferCtx.putImageData(buffer, 0, 0);
        ctx.drawImage(bufferCanvas, 0, 0, screenSize.width, screenSize.height);
        dirty = false;
    }
    requestAnimationFrame(drawCanvas);
}
requestAnimationFrame(drawCanvas);

function keyDownHandler(event) {
    if (event.keyCode == 8) {
        sharedArray[0] = 0; // BUTTON_BACK_PRESSED
    } else if (event.keyCode == 13) {
        sharedArray[0] = 6; // BUTTON_SELECT_PRESSED
    } else if (event.keyCode == 37) {
        sharedArray[0] = 4; // BUTTON_LEFT_PRESSED
    } else if (event.keyCode == 39) {
        sharedArray[0] = 5; // BUTTON_RIGHT_PRESSED
    } else if (event.keyCode == 38) {
        sharedArray[0] = 2; // BUTTON_UP_PRESSED
    } else if (event.keyCode == 40) {
        sharedArray[0] = 3; // BUTTON_DOWN_PRESSED
    } else if (event.keyCode == 111) {
        sharedArray[0] = 7; // BUTTON_INSTANT_REPLAY_PRESSED
    } else if (event.keyCode == 106) {
        sharedArray[0] = 10; // BUTTON_INFO_PRESSED
    } else if (event.keyCode == 188) {
        sharedArray[0] = 8; // BUTTON_REWIND_PRESSED
    } else if (event.keyCode == 32) {
        sharedArray[0] = 13; // BUTTON_PLAY_PRESSED
    } else if (event.keyCode == 190) {
        sharedArray[0] = 9; // BUTTON_FAST_FORWARD_PRESSED
    } else if (event.keyCode == 65) {
        sharedArray[0] = 17; // BUTTON_A_PRESSED
    } else if (event.keyCode == 90) {
        sharedArray[0] = 18; // BUTTON_B_PRESSED
    } else if (event.keyCode == 27) {
        if (brsWorker != undefined) {
            // HOME BUTTON (ESC)
            display.style.display = "none";
            fileSelector.value = null;
            brsWorker.terminate();
        }
    }
}

function keyUpHandler(event) {
    if (event.keyCode == 8) {
        sharedArray[0] = 100; // BUTTON_BACK_RELEASED
    } else if (event.keyCode == 13) {
        sharedArray[0] = 106; // BUTTON_SELECT_RELEASED
    } else if (event.keyCode == 37) {
        sharedArray[0] = 104; // BUTTON_LEFT_RELEASED
    } else if (event.keyCode == 39) {
        sharedArray[0] = 105; // BUTTON_RIGHT_RELEASED
    } else if (event.keyCode == 38) {
        sharedArray[0] = 102; // BUTTON_UP_RELEASED
    } else if (event.keyCode == 40) {
        sharedArray[0] = 103; // BUTTON_DOWN_RELEASED
    } else if (event.keyCode == 111) {
        sharedArray[0] = 107; // BUTTON_INSTANT_REPLAY_RELEASED
    } else if (event.keyCode == 106) {
        sharedArray[0] = 110; // BUTTON_INFO_RELEASED
    } else if (event.keyCode == 188) {
        sharedArray[0] = 108; // BUTTON_REWIND_RELEASED
    } else if (event.keyCode == 32) {
        sharedArray[0] = 113; // BUTTON_PLAY_RELEASED
    } else if (event.keyCode == 190) {
        sharedArray[0] = 109; // BUTTON_FAST_FORWARD_RELEASED
    } else if (event.keyCode == 65) {
        sharedArray[0] = 117; // BUTTON_A_RELEASED
    } else if (event.keyCode == 90) {
        sharedArray[0] = 118; // BUTTON_B_RELEASED
    }
}
