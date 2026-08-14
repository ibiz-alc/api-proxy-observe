(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));

  // node_modules/yuv-buffer/yuv-buffer.js
  var require_yuv_buffer = __commonJS({
    "node_modules/yuv-buffer/yuv-buffer.js"(exports, module) {
      var YUVBuffer = {
        /**
         * Validate a plane dimension
         * @param {number} dim - vertical or horizontal dimension
         * @throws exception on zero, negative, or non-integer value
         */
        validateDimension: function(dim) {
          if (dim <= 0 || dim !== (dim | 0)) {
            throw "YUV plane dimensions must be a positive integer";
          }
        },
        /**
         * Validate a plane offset
         * @param {number} dim - vertical or horizontal dimension
         * @throws exception on negative or non-integer value
         */
        validateOffset: function(dim) {
          if (dim < 0 || dim !== (dim | 0)) {
            throw "YUV plane offsets must be a non-negative integer";
          }
        },
        /**
         * Validate and fill out a YUVFormat object structure.
         *
         * At least width and height fields are required; other fields will be
         * derived if left missing or empty:
         * - chromaWidth and chromaHeight will be copied from width and height as for a 4:4:4 layout
         * - cropLeft and cropTop will be 0
         * - cropWidth and cropHeight will be set to whatever of the frame is visible after cropTop and cropLeft are applied
         * - displayWidth and displayHeight will be set to cropWidth and cropHeight.
         *
         * @param {YUVFormat} fields - input fields, must include width and height.
         * @returns {YUVFormat} - validated structure, with all derivable fields filled out.
         * @throws exception on invalid fields or missing width/height
         */
        format: function(fields) {
          var width = fields.width, height = fields.height, chromaWidth = fields.chromaWidth || width, chromaHeight = fields.chromaHeight || height, cropLeft = fields.cropLeft || 0, cropTop = fields.cropTop || 0, cropWidth = fields.cropWidth || width - cropLeft, cropHeight = fields.cropHeight || height - cropTop, displayWidth = fields.displayWidth || cropWidth, displayHeight = fields.displayHeight || cropHeight;
          this.validateDimension(width);
          this.validateDimension(height);
          this.validateDimension(chromaWidth);
          this.validateDimension(chromaHeight);
          this.validateOffset(cropLeft);
          this.validateOffset(cropTop);
          this.validateDimension(cropWidth);
          this.validateDimension(cropHeight);
          this.validateDimension(displayWidth);
          this.validateDimension(displayHeight);
          return {
            width,
            height,
            chromaWidth,
            chromaHeight,
            cropLeft,
            cropTop,
            cropWidth,
            cropHeight,
            displayWidth,
            displayHeight
          };
        },
        /**
         * Pick a suitable stride for a custom-allocated thingy
         * @param {number} width - width in bytes
         * @returns {number} - new width in bytes at least as large
         * @throws exception on invalid input width
         */
        suitableStride: function(width) {
          YUVBuffer.validateDimension(width);
          var alignment = 4, remainder = width % alignment;
          if (remainder == 0) {
            return width;
          } else {
            return width + (alignment - remainder);
          }
        },
        /**
         * Allocate or extract a YUVPlane object from given dimensions/source.
         * @param {number} width - width in pixels
         * @param {number} height - height in pixels
         * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
         * @param {number} stride - row length in bytes; optional (will create a default if missing)
         * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
         * @returns {YUVPlane} - freshly allocated planar buffer
         */
        allocPlane: function(width, height, source, stride, offset) {
          var size, bytes;
          this.validateDimension(width);
          this.validateDimension(height);
          offset = offset || 0;
          stride = stride || this.suitableStride(width);
          this.validateDimension(stride);
          if (stride < width) {
            throw "Invalid input stride for YUV plane; must be larger than width";
          }
          size = stride * height;
          if (source) {
            if (source.length - offset < size) {
              throw "Invalid input buffer for YUV plane; must be large enough for stride times height";
            }
            bytes = source.slice(offset, offset + size);
          } else {
            bytes = new Uint8Array(size);
            stride = stride || this.suitableStride(width);
          }
          return {
            bytes,
            stride
          };
        },
        /**
         * Allocate a new YUVPlane object big enough for a luma plane in the given format
         * @param {YUVFormat} format - target frame format
         * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
         * @param {number} stride - row length in bytes; optional (will create a default if missing)
         * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
         * @returns {YUVPlane} - freshly allocated planar buffer
         */
        lumaPlane: function(format, source, stride, offset) {
          return this.allocPlane(format.width, format.height, source, stride, offset);
        },
        /**
         * Allocate a new YUVPlane object big enough for a chroma plane in the given format,
         * optionally copying data from an existing buffer.
         *
         * @param {YUVFormat} format - target frame format
         * @param {Uint8Array} source - input byte array; optional (will create empty buffer if missing)
         * @param {number} stride - row length in bytes; optional (will create a default if missing)
         * @param {number} offset - offset into source array to extract; optional (will start at 0 if missing)
         * @returns {YUVPlane} - freshly allocated planar buffer
         */
        chromaPlane: function(format, source, stride, offset) {
          return this.allocPlane(format.chromaWidth, format.chromaHeight, source, stride, offset);
        },
        /**
         * Allocate a new YUVFrame object big enough for the given format
         * @param {YUVFormat} format - target frame format
         * @param {YUVPlane} y - optional Y plane; if missing, fresh one will be allocated
         * @param {YUVPlane} u - optional U plane; if missing, fresh one will be allocated
         * @param {YUVPlane} v - optional V plane; if missing, fresh one will be allocated
         * @returns {YUVFrame} - freshly allocated frame buffer
         */
        frame: function(format, y, u, v) {
          y = y || this.lumaPlane(format);
          u = u || this.chromaPlane(format);
          v = v || this.chromaPlane(format);
          return {
            format,
            y,
            u,
            v
          };
        },
        /**
         * Duplicate a plane using new buffer memory.
         * @param {YUVPlane} plane - input plane to copy
         * @returns {YUVPlane} - freshly allocated and filled planar buffer
         */
        copyPlane: function(plane) {
          return {
            bytes: plane.bytes.slice(),
            stride: plane.stride
          };
        },
        /**
         * Duplicate a frame using new buffer memory.
         * @param {YUVFrame} frame - input frame to copyFrame
         * @returns {YUVFrame} - freshly allocated and filled frame buffer
         */
        copyFrame: function(frame) {
          return {
            format: frame.format,
            y: this.copyPlane(frame.y),
            u: this.copyPlane(frame.u),
            v: this.copyPlane(frame.v)
          };
        },
        /**
         * List the backing buffers for the frame's planes for transfer between
         * threads via Worker.postMessage.
         * @param {YUVFrame} frame - input frame
         * @returns {Array} - list of transferable objects
         */
        transferables: function(frame) {
          return [frame.y.bytes.buffer, frame.u.bytes.buffer, frame.v.bytes.buffer];
        }
      };
      module.exports = YUVBuffer;
    }
  });

  // node_modules/yuv-canvas/src/FrameSink.js
  var require_FrameSink = __commonJS({
    "node_modules/yuv-canvas/src/FrameSink.js"(exports, module) {
      (function() {
        "use strict";
        function FrameSink(canvas, options) {
          throw new Error("abstract");
        }
        FrameSink.prototype.drawFrame = function(buffer) {
          throw new Error("abstract");
        };
        FrameSink.prototype.clear = function() {
          throw new Error("abstract");
        };
        module.exports = FrameSink;
      })();
    }
  });

  // node_modules/yuv-canvas/src/depower.js
  var require_depower = __commonJS({
    "node_modules/yuv-canvas/src/depower.js"(exports, module) {
      (function() {
        "use strict";
        function depower(ratio) {
          var shiftCount = 0, n = ratio >> 1;
          while (n != 0) {
            n = n >> 1;
            shiftCount++;
          }
          if (ratio !== 1 << shiftCount) {
            throw "chroma plane dimensions must be power of 2 ratio to luma plane dimensions; got " + ratio;
          }
          return shiftCount;
        }
        module.exports = depower;
      })();
    }
  });

  // node_modules/yuv-canvas/src/YCbCr.js
  var require_YCbCr = __commonJS({
    "node_modules/yuv-canvas/src/YCbCr.js"(exports, module) {
      (function() {
        "use strict";
        var depower = require_depower();
        function convertYCbCr(buffer, output) {
          var width = buffer.format.width | 0, height = buffer.format.height | 0, hdec = depower(buffer.format.width / buffer.format.chromaWidth) | 0, vdec = depower(buffer.format.height / buffer.format.chromaHeight) | 0, bytesY = buffer.y.bytes, bytesCb = buffer.u.bytes, bytesCr = buffer.v.bytes, strideY = buffer.y.stride | 0, strideCb = buffer.u.stride | 0, strideCr = buffer.v.stride | 0, outStride = width << 2, YPtr = 0, Y0Ptr = 0, Y1Ptr = 0, CbPtr = 0, CrPtr = 0, outPtr = 0, outPtr0 = 0, outPtr1 = 0, colorCb = 0, colorCr = 0, multY = 0, multCrR = 0, multCbCrG = 0, multCbB = 0, x = 0, y = 0, xdec = 0, ydec = 0;
          if (hdec == 1 && vdec == 1) {
            outPtr0 = 0;
            outPtr1 = outStride;
            ydec = 0;
            for (y = 0; y < height; y += 2) {
              Y0Ptr = y * strideY | 0;
              Y1Ptr = Y0Ptr + strideY | 0;
              CbPtr = ydec * strideCb | 0;
              CrPtr = ydec * strideCr | 0;
              for (x = 0; x < width; x += 2) {
                colorCb = bytesCb[CbPtr++] | 0;
                colorCr = bytesCr[CrPtr++] | 0;
                multCrR = (409 * colorCr | 0) - 57088 | 0;
                multCbCrG = (100 * colorCb | 0) + (208 * colorCr | 0) - 34816 | 0;
                multCbB = (516 * colorCb | 0) - 70912 | 0;
                multY = 298 * bytesY[Y0Ptr++] | 0;
                output[outPtr0] = multY + multCrR >> 8;
                output[outPtr0 + 1] = multY - multCbCrG >> 8;
                output[outPtr0 + 2] = multY + multCbB >> 8;
                outPtr0 += 4;
                multY = 298 * bytesY[Y0Ptr++] | 0;
                output[outPtr0] = multY + multCrR >> 8;
                output[outPtr0 + 1] = multY - multCbCrG >> 8;
                output[outPtr0 + 2] = multY + multCbB >> 8;
                outPtr0 += 4;
                multY = 298 * bytesY[Y1Ptr++] | 0;
                output[outPtr1] = multY + multCrR >> 8;
                output[outPtr1 + 1] = multY - multCbCrG >> 8;
                output[outPtr1 + 2] = multY + multCbB >> 8;
                outPtr1 += 4;
                multY = 298 * bytesY[Y1Ptr++] | 0;
                output[outPtr1] = multY + multCrR >> 8;
                output[outPtr1 + 1] = multY - multCbCrG >> 8;
                output[outPtr1 + 2] = multY + multCbB >> 8;
                outPtr1 += 4;
              }
              outPtr0 += outStride;
              outPtr1 += outStride;
              ydec++;
            }
          } else {
            outPtr = 0;
            for (y = 0; y < height; y++) {
              xdec = 0;
              ydec = y >> vdec;
              YPtr = y * strideY | 0;
              CbPtr = ydec * strideCb | 0;
              CrPtr = ydec * strideCr | 0;
              for (x = 0; x < width; x++) {
                xdec = x >> hdec;
                colorCb = bytesCb[CbPtr + xdec] | 0;
                colorCr = bytesCr[CrPtr + xdec] | 0;
                multCrR = (409 * colorCr | 0) - 57088 | 0;
                multCbCrG = (100 * colorCb | 0) + (208 * colorCr | 0) - 34816 | 0;
                multCbB = (516 * colorCb | 0) - 70912 | 0;
                multY = 298 * bytesY[YPtr++] | 0;
                output[outPtr] = multY + multCrR >> 8;
                output[outPtr + 1] = multY - multCbCrG >> 8;
                output[outPtr + 2] = multY + multCbB >> 8;
                outPtr += 4;
              }
            }
          }
        }
        module.exports = {
          convertYCbCr
        };
      })();
    }
  });

  // node_modules/yuv-canvas/src/SoftwareFrameSink.js
  var require_SoftwareFrameSink = __commonJS({
    "node_modules/yuv-canvas/src/SoftwareFrameSink.js"(exports, module) {
      (function() {
        "use strict";
        var FrameSink = require_FrameSink(), YCbCr = require_YCbCr();
        function SoftwareFrameSink(canvas) {
          var self = this, ctx = canvas.getContext("2d"), imageData = null, resampleCanvas = null, resampleContext = null;
          function initImageData(width, height) {
            imageData = ctx.createImageData(width, height);
            var data = imageData.data, pixelCount = width * height * 4;
            for (var i = 0; i < pixelCount; i += 4) {
              data[i + 3] = 255;
            }
          }
          function initResampleCanvas(cropWidth, cropHeight) {
            resampleCanvas = document.createElement("canvas");
            resampleCanvas.width = cropWidth;
            resampleCanvas.height = cropHeight;
            resampleContext = resampleCanvas.getContext("2d");
          }
          self.drawFrame = function drawFrame(buffer) {
            var format = buffer.format;
            if (canvas.width !== format.displayWidth || canvas.height !== format.displayHeight) {
              canvas.width = format.displayWidth;
              canvas.height = format.displayHeight;
            }
            if (imageData === null || imageData.width != format.width || imageData.height != format.height) {
              initImageData(format.width, format.height);
            }
            YCbCr.convertYCbCr(buffer, imageData.data);
            var resample = format.cropWidth != format.displayWidth || format.cropHeight != format.displayHeight;
            var drawContext;
            if (resample) {
              if (!resampleCanvas) {
                initResampleCanvas(format.cropWidth, format.cropHeight);
              }
              drawContext = resampleContext;
            } else {
              drawContext = ctx;
            }
            drawContext.putImageData(
              imageData,
              -format.cropLeft,
              -format.cropTop,
              // must offset the offset
              format.cropLeft,
              format.cropTop,
              format.cropWidth,
              format.cropHeight
            );
            if (resample) {
              ctx.drawImage(resampleCanvas, 0, 0, format.displayWidth, format.displayHeight);
            }
          };
          self.clear = function() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
          };
          return self;
        }
        SoftwareFrameSink.prototype = Object.create(FrameSink.prototype);
        module.exports = SoftwareFrameSink;
      })();
    }
  });

  // node_modules/yuv-canvas/build/shaders.js
  var require_shaders = __commonJS({
    "node_modules/yuv-canvas/build/shaders.js"(exports, module) {
      module.exports = {
        vertex: "precision mediump float;\n\nattribute vec2 aPosition;\nattribute vec2 aLumaPosition;\nattribute vec2 aChromaPosition;\nvarying vec2 vLumaPosition;\nvarying vec2 vChromaPosition;\nvoid main() {\n    gl_Position = vec4(aPosition, 0, 1);\n    vLumaPosition = aLumaPosition;\n    vChromaPosition = aChromaPosition;\n}\n",
        fragment: "// inspired by https://github.com/mbebenita/Broadway/blob/master/Player/canvas.js\n\nprecision mediump float;\n\nuniform sampler2D uTextureY;\nuniform sampler2D uTextureCb;\nuniform sampler2D uTextureCr;\nvarying vec2 vLumaPosition;\nvarying vec2 vChromaPosition;\nvoid main() {\n   // Y, Cb, and Cr planes are uploaded as ALPHA textures.\n   float fY = texture2D(uTextureY, vLumaPosition).w;\n   float fCb = texture2D(uTextureCb, vChromaPosition).w;\n   float fCr = texture2D(uTextureCr, vChromaPosition).w;\n\n   // Premultipy the Y...\n   float fYmul = fY * 1.1643828125;\n\n   // And convert that to RGB!\n   gl_FragColor = vec4(\n     fYmul + 1.59602734375 * fCr - 0.87078515625,\n     fYmul - 0.39176171875 * fCb - 0.81296875 * fCr + 0.52959375,\n     fYmul + 2.017234375   * fCb - 1.081390625,\n     1\n   );\n}\n",
        vertexStripe: "precision mediump float;\n\nattribute vec2 aPosition;\nattribute vec2 aTexturePosition;\nvarying vec2 vTexturePosition;\n\nvoid main() {\n    gl_Position = vec4(aPosition, 0, 1);\n    vTexturePosition = aTexturePosition;\n}\n",
        fragmentStripe: "// extra 'stripe' texture fiddling to work around IE 11's poor performance on gl.LUMINANCE and gl.ALPHA textures\n\nprecision mediump float;\n\nuniform sampler2D uStripe;\nuniform sampler2D uTexture;\nvarying vec2 vTexturePosition;\nvoid main() {\n   // Y, Cb, and Cr planes are mapped into a pseudo-RGBA texture\n   // so we can upload them without expanding the bytes on IE 11\n   // which doesn't allow LUMINANCE or ALPHA textures\n   // The stripe textures mark which channel to keep for each pixel.\n   // Each texture extraction will contain the relevant value in one\n   // channel only.\n\n   float fLuminance = dot(\n      texture2D(uStripe, vTexturePosition),\n      texture2D(uTexture, vTexturePosition)\n   );\n\n   gl_FragColor = vec4(0, 0, 0, fLuminance);\n}\n"
      };
    }
  });

  // node_modules/yuv-canvas/src/WebGLFrameSink.js
  var require_WebGLFrameSink = __commonJS({
    "node_modules/yuv-canvas/src/WebGLFrameSink.js"(exports, module) {
      (function() {
        "use strict";
        var FrameSink = require_FrameSink(), shaders = require_shaders();
        function WebGLFrameSink(canvas) {
          var self = this, gl = WebGLFrameSink.contextForCanvas(canvas), debug = false;
          if (gl === null) {
            throw new Error("WebGL unavailable");
          }
          function checkError() {
            if (debug) {
              err = gl.getError();
              if (err !== 0) {
                throw new Error("GL error " + err);
              }
            }
          }
          function compileShader(type, source) {
            var shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
              var err2 = gl.getShaderInfoLog(shader);
              gl.deleteShader(shader);
              throw new Error("GL shader compilation for " + type + " failed: " + err2);
            }
            return shader;
          }
          var program, unpackProgram, err;
          var rectangle = new Float32Array([
            // First triangle (top left, clockwise)
            -1,
            -1,
            1,
            -1,
            -1,
            1,
            // Second triangle (bottom right, clockwise)
            -1,
            1,
            1,
            -1,
            1,
            1
          ]);
          var textures = {};
          var framebuffers = {};
          var stripes = {};
          var buf, positionLocation, unpackPositionLocation;
          var unpackTexturePositionBuffer, unpackTexturePositionLocation;
          var stripeLocation, unpackTextureLocation;
          var lumaPositionBuffer, lumaPositionLocation;
          var chromaPositionBuffer, chromaPositionLocation;
          function createOrReuseTexture(name, formatUpdate) {
            if (!textures[name] || formatUpdate) {
              textures[name] = gl.createTexture();
            }
            return textures[name];
          }
          function uploadTexture(name, formatUpdate, width, height, data) {
            var create = !textures[name] || formatUpdate;
            var texture = createOrReuseTexture(name, formatUpdate);
            gl.activeTexture(gl.TEXTURE0);
            if (WebGLFrameSink.stripe) {
              var uploadTemp = !textures[name + "_temp"] || formatUpdate;
              var tempTexture = createOrReuseTexture(name + "_temp", formatUpdate);
              gl.bindTexture(gl.TEXTURE_2D, tempTexture);
              if (uploadTemp) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  // mip level
                  gl.RGBA,
                  // internal format
                  width / 4,
                  height,
                  0,
                  // border
                  gl.RGBA,
                  // format
                  gl.UNSIGNED_BYTE,
                  // type
                  data
                  // data!
                );
              } else {
                gl.texSubImage2D(
                  gl.TEXTURE_2D,
                  0,
                  // mip level
                  0,
                  // x offset
                  0,
                  // y offset
                  width / 4,
                  height,
                  gl.RGBA,
                  // format
                  gl.UNSIGNED_BYTE,
                  // type
                  data
                  // data!
                );
              }
              var stripeTexture = textures[name + "_stripe"];
              var uploadStripe = !stripeTexture || formatUpdate;
              if (uploadStripe) {
                stripeTexture = createOrReuseTexture(name + "_stripe", formatUpdate);
              }
              gl.bindTexture(gl.TEXTURE_2D, stripeTexture);
              if (uploadStripe) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  // mip level
                  gl.RGBA,
                  // internal format
                  width,
                  1,
                  0,
                  // border
                  gl.RGBA,
                  // format
                  gl.UNSIGNED_BYTE,
                  //type
                  buildStripe(width, 1)
                  // data!
                );
              }
            } else {
              gl.bindTexture(gl.TEXTURE_2D, texture);
              if (create) {
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texImage2D(
                  gl.TEXTURE_2D,
                  0,
                  // mip level
                  gl.ALPHA,
                  // internal format
                  width,
                  height,
                  0,
                  // border
                  gl.ALPHA,
                  // format
                  gl.UNSIGNED_BYTE,
                  //type
                  data
                  // data!
                );
              } else {
                gl.texSubImage2D(
                  gl.TEXTURE_2D,
                  0,
                  // mip level
                  0,
                  // x
                  0,
                  // y
                  width,
                  height,
                  gl.ALPHA,
                  // internal format
                  gl.UNSIGNED_BYTE,
                  //type
                  data
                  // data!
                );
              }
            }
          }
          function unpackTexture(name, formatUpdate, width, height) {
            var texture = textures[name];
            gl.useProgram(unpackProgram);
            var fb = framebuffers[name];
            if (!fb || formatUpdate) {
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, texture);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
              gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
              gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                // mip level
                gl.RGBA,
                // internal format
                width,
                height,
                0,
                // border
                gl.RGBA,
                // format
                gl.UNSIGNED_BYTE,
                //type
                null
                // data!
              );
              fb = framebuffers[name] = gl.createFramebuffer();
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            var tempTexture = textures[name + "_temp"];
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tempTexture);
            gl.uniform1i(unpackTextureLocation, 1);
            var stripeTexture = textures[name + "_stripe"];
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, stripeTexture);
            gl.uniform1i(stripeLocation, 2);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, unpackTexturePositionBuffer);
            gl.enableVertexAttribArray(unpackTexturePositionLocation);
            gl.vertexAttribPointer(unpackTexturePositionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.viewport(0, 0, width, height);
            gl.drawArrays(gl.TRIANGLES, 0, rectangle.length / 2);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
          }
          function attachTexture(name, register, index) {
            gl.activeTexture(register);
            gl.bindTexture(gl.TEXTURE_2D, textures[name]);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.uniform1i(gl.getUniformLocation(program, name), index);
          }
          function buildStripe(width) {
            if (stripes[width]) {
              return stripes[width];
            }
            var len = width, out = new Uint32Array(len);
            for (var i = 0; i < len; i += 4) {
              out[i] = 255;
              out[i + 1] = 65280;
              out[i + 2] = 16711680;
              out[i + 3] = 4278190080;
            }
            return stripes[width] = new Uint8Array(out.buffer);
          }
          function initProgram(vertexShaderSource, fragmentShaderSource) {
            var vertexShader = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
            var fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
            var program2 = gl.createProgram();
            gl.attachShader(program2, vertexShader);
            gl.attachShader(program2, fragmentShader);
            gl.linkProgram(program2);
            if (!gl.getProgramParameter(program2, gl.LINK_STATUS)) {
              var err2 = gl.getProgramInfoLog(program2);
              gl.deleteProgram(program2);
              throw new Error("GL program linking failed: " + err2);
            }
            return program2;
          }
          function init() {
            if (WebGLFrameSink.stripe) {
              unpackProgram = initProgram(shaders.vertexStripe, shaders.fragmentStripe);
              unpackPositionLocation = gl.getAttribLocation(unpackProgram, "aPosition");
              unpackTexturePositionBuffer = gl.createBuffer();
              var textureRectangle = new Float32Array([
                0,
                0,
                1,
                0,
                0,
                1,
                0,
                1,
                1,
                0,
                1,
                1
              ]);
              gl.bindBuffer(gl.ARRAY_BUFFER, unpackTexturePositionBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, textureRectangle, gl.STATIC_DRAW);
              unpackTexturePositionLocation = gl.getAttribLocation(unpackProgram, "aTexturePosition");
              stripeLocation = gl.getUniformLocation(unpackProgram, "uStripe");
              unpackTextureLocation = gl.getUniformLocation(unpackProgram, "uTexture");
            }
            program = initProgram(shaders.vertex, shaders.fragment);
            buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER, rectangle, gl.STATIC_DRAW);
            positionLocation = gl.getAttribLocation(program, "aPosition");
            lumaPositionBuffer = gl.createBuffer();
            lumaPositionLocation = gl.getAttribLocation(program, "aLumaPosition");
            chromaPositionBuffer = gl.createBuffer();
            chromaPositionLocation = gl.getAttribLocation(program, "aChromaPosition");
          }
          self.drawFrame = function(buffer) {
            var format = buffer.format;
            var formatUpdate = !program || canvas.width !== format.displayWidth || canvas.height !== format.displayHeight;
            if (formatUpdate) {
              canvas.width = format.displayWidth;
              canvas.height = format.displayHeight;
              self.clear();
            }
            if (!program) {
              init();
            }
            if (formatUpdate) {
              var setupTexturePosition = function(buffer2, location2, texWidth) {
                var textureX0 = format.cropLeft / texWidth;
                var textureX1 = (format.cropLeft + format.cropWidth) / texWidth;
                var textureY0 = (format.cropTop + format.cropHeight) / format.height;
                var textureY1 = format.cropTop / format.height;
                var textureRectangle = new Float32Array([
                  textureX0,
                  textureY0,
                  textureX1,
                  textureY0,
                  textureX0,
                  textureY1,
                  textureX0,
                  textureY1,
                  textureX1,
                  textureY0,
                  textureX1,
                  textureY1
                ]);
                gl.bindBuffer(gl.ARRAY_BUFFER, buffer2);
                gl.bufferData(gl.ARRAY_BUFFER, textureRectangle, gl.STATIC_DRAW);
              };
              setupTexturePosition(
                lumaPositionBuffer,
                lumaPositionLocation,
                buffer.y.stride
              );
              setupTexturePosition(
                chromaPositionBuffer,
                chromaPositionLocation,
                buffer.u.stride * format.width / format.chromaWidth
              );
            }
            uploadTexture("uTextureY", formatUpdate, buffer.y.stride, format.height, buffer.y.bytes);
            uploadTexture("uTextureCb", formatUpdate, buffer.u.stride, format.chromaHeight, buffer.u.bytes);
            uploadTexture("uTextureCr", formatUpdate, buffer.v.stride, format.chromaHeight, buffer.v.bytes);
            if (WebGLFrameSink.stripe) {
              unpackTexture("uTextureY", formatUpdate, buffer.y.stride, format.height);
              unpackTexture("uTextureCb", formatUpdate, buffer.u.stride, format.chromaHeight);
              unpackTexture("uTextureCr", formatUpdate, buffer.v.stride, format.chromaHeight);
            }
            gl.useProgram(program);
            gl.viewport(0, 0, canvas.width, canvas.height);
            attachTexture("uTextureY", gl.TEXTURE0, 0);
            attachTexture("uTextureCb", gl.TEXTURE1, 1);
            attachTexture("uTextureCr", gl.TEXTURE2, 2);
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.enableVertexAttribArray(positionLocation);
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, lumaPositionBuffer);
            gl.enableVertexAttribArray(lumaPositionLocation);
            gl.vertexAttribPointer(lumaPositionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.bindBuffer(gl.ARRAY_BUFFER, chromaPositionBuffer);
            gl.enableVertexAttribArray(chromaPositionLocation);
            gl.vertexAttribPointer(chromaPositionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, rectangle.length / 2);
          };
          self.clear = function() {
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
          };
          self.clear();
          return self;
        }
        WebGLFrameSink.stripe = false;
        WebGLFrameSink.contextForCanvas = function(canvas) {
          var options = {
            // Don't trigger discrete GPU in multi-GPU systems
            preferLowPowerToHighPerformance: true,
            powerPreference: "low-power",
            // Don't try to use software GL rendering!
            failIfMajorPerformanceCaveat: true,
            // In case we need to capture the resulting output.
            preserveDrawingBuffer: true
          };
          return canvas.getContext("webgl", options) || canvas.getContext("experimental-webgl", options);
        };
        WebGLFrameSink.isAvailable = function() {
          var canvas = document.createElement("canvas"), gl;
          canvas.width = 1;
          canvas.height = 1;
          try {
            gl = WebGLFrameSink.contextForCanvas(canvas);
          } catch (e) {
            return false;
          }
          if (gl) {
            var register = gl.TEXTURE0, width = 4, height = 4, texture = gl.createTexture(), data = new Uint8Array(width * height), texWidth = WebGLFrameSink.stripe ? width / 4 : width, format = WebGLFrameSink.stripe ? gl.RGBA : gl.ALPHA, filter = WebGLFrameSink.stripe ? gl.NEAREST : gl.LINEAR;
            gl.activeTexture(register);
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
            gl.texImage2D(
              gl.TEXTURE_2D,
              0,
              // mip level
              format,
              // internal format
              texWidth,
              height,
              0,
              // border
              format,
              // format
              gl.UNSIGNED_BYTE,
              //type
              data
              // data!
            );
            var err = gl.getError();
            if (err) {
              return false;
            } else {
              return true;
            }
          } else {
            return false;
          }
        };
        WebGLFrameSink.prototype = Object.create(FrameSink.prototype);
        module.exports = WebGLFrameSink;
      })();
    }
  });

  // node_modules/yuv-canvas/src/yuv-canvas.js
  var require_yuv_canvas = __commonJS({
    "node_modules/yuv-canvas/src/yuv-canvas.js"(exports, module) {
      (function() {
        "use strict";
        var FrameSink = require_FrameSink(), SoftwareFrameSink = require_SoftwareFrameSink(), WebGLFrameSink = require_WebGLFrameSink();
        var YUVCanvas = {
          FrameSink,
          SoftwareFrameSink,
          WebGLFrameSink,
          /**
           * Attach a suitable FrameSink instance to an HTML5 canvas element.
           *
           * This will take over the drawing context of the canvas and may turn
           * it into a WebGL 3d canvas if possible. Do not attempt to use the
           * drawing context directly after this.
           *
           * @param {HTMLCanvasElement} canvas - HTML canvas element to attach to
           * @param {YUVCanvasOptions} options - map of options
           * @returns {FrameSink} - instance of suitable subclass.
           */
          attach: function(canvas, options) {
            options = options || {};
            var webGL = "webGL" in options ? options.webGL : WebGLFrameSink.isAvailable();
            if (webGL) {
              return new WebGLFrameSink(canvas, options);
            } else {
              return new SoftwareFrameSink(canvas, options);
            }
          }
        };
        module.exports = YUVCanvas;
      })();
    }
  });

  // node_modules/@yume-chan/scrcpy/esm/base/video.js
  var ScrcpyVideoCodecId = {
    H264: 1748121140,
    H265: 1748121141,
    AV1: 6387249
  };

  // node_modules/@yume-chan/async/esm/promise-resolver.js
  var PromiseResolver = class {
    #promise;
    get promise() {
      return this.#promise;
    }
    #resolve;
    #reject;
    #state = "running";
    get state() {
      return this.#state;
    }
    constructor() {
      this.#promise = new Promise((resolve, reject) => {
        this.#resolve = resolve;
        this.#reject = reject;
      });
    }
    resolve = (value) => {
      this.#resolve(value);
      this.#state = "resolved";
    };
    reject = (reason) => {
      this.#reject(reason);
      this.#state = "rejected";
    };
  };

  // node_modules/@yume-chan/no-data-view/esm/uint32.js
  // @__NO_SIDE_EFFECTS__
  function getUint32LittleEndian(buffer, offset) {
    return (buffer[offset] | buffer[offset + 1] << 8 | buffer[offset + 2] << 16 | buffer[offset + 3] << 24) >>> 0;
  }

  // node_modules/@yume-chan/stream-extra/esm/stream.js
  var { AbortController } = globalThis;
  var { WritableStream, TransformStream } = globalThis;

  // node_modules/@yume-chan/scrcpy/esm/codec/av1.js
  var AndroidAv1Profile = {
    Main8: 1 << 0,
    Main10: 1 << 1,
    Main10Hdr10: 1 << 12,
    Main10Hdr10Plus: 1 << 13
  };
  var AndroidAv1Level = {
    Level2: 1 << 0,
    Level21: 1 << 1,
    Level22: 1 << 2,
    Level23: 1 << 3,
    Level3: 1 << 4,
    Level31: 1 << 5,
    Level32: 1 << 6,
    Level33: 1 << 7,
    Level4: 1 << 8,
    Level41: 1 << 9,
    Level42: 1 << 10,
    Level43: 1 << 11,
    Level5: 1 << 12,
    Level51: 1 << 13,
    Level52: 1 << 14,
    Level53: 1 << 15,
    Level6: 1 << 16,
    Level61: 1 << 17,
    Level62: 1 << 18,
    Level63: 1 << 19,
    Level7: 1 << 20,
    Level71: 1 << 21,
    Level72: 1 << 22,
    Level73: 1 << 23
  };
  var BitReader = class {
    #data;
    #byte;
    #bytePosition = 0;
    #bitPosition = 7;
    get byteAligned() {
      return this.#bitPosition === 7;
    }
    get ended() {
      return this.#bytePosition >= this.#data.length;
    }
    constructor(data) {
      this.#data = data;
      this.#byte = data[0];
    }
    f1() {
      const value = this.#byte >> this.#bitPosition;
      this.#bitPosition -= 1;
      if (this.#bitPosition < 0) {
        this.#bytePosition += 1;
        this.#bitPosition = 7;
        this.#byte = this.#data[this.#bytePosition];
      }
      return value & 1;
    }
    f(n) {
      let value = 0;
      for (; n > 0; n -= 1) {
        value <<= 1;
        value |= this.f1();
      }
      return value;
    }
    skip(n) {
      if (n <= this.#bitPosition + 1) {
        this.#bytePosition += 1;
        this.#bitPosition = 7;
        this.#byte = this.#data[this.#bytePosition];
        return;
      }
      n -= this.#bitPosition + 1;
      this.#bytePosition += 1;
      const bytes = n / 8 | 0;
      if (bytes > 0) {
        this.#bytePosition += bytes;
        n -= bytes * 8;
      }
      this.#bitPosition = 7 - n;
      this.#byte = this.#data[this.#bytePosition];
    }
    readBytes(n) {
      if (!this.byteAligned) {
        throw new Error("Bytes must be byte-aligned");
      }
      const value = this.#data.subarray(this.#bytePosition, this.#bytePosition + n);
      this.#bytePosition += n;
      this.#byte = this.#data[this.#bytePosition];
      return value;
    }
    getPosition() {
      return [this.#bytePosition, this.#bitPosition];
    }
    setPosition([bytePosition, bitPosition]) {
      this.#bytePosition = bytePosition;
      this.#bitPosition = bitPosition;
      this.#byte = this.#data[bytePosition];
    }
  };
  var ObuType = {
    SequenceHeader: 1,
    TemporalDelimiter: 2,
    FrameHeader: 3,
    TileGroup: 4,
    Metadata: 5,
    Frame: 6,
    RedundantFrameHeader: 7,
    TileList: 8,
    Padding: 15
  };
  var ColorPrimaries = {
    Bt709: 1,
    Unspecified: 2,
    Bt470M: 4,
    Bt470BG: 5,
    Bt601: 6,
    Smpte240: 7,
    GenericFilm: 8,
    Bt2020: 9,
    Xyz: 10,
    Smpte431: 11,
    Smpte432: 12,
    Ebu3213: 22
  };
  var TransferCharacteristics = {
    Bt709: 1,
    Unspecified: 2,
    Bt470M: 4,
    Bt470BG: 5,
    Bt601: 6,
    Smpte240: 7,
    Linear: 8,
    Log100: 9,
    Log100Sqrt10: 10,
    Iec61966: 11,
    Bt1361: 12,
    Srgb: 13,
    Bt2020Ten: 14,
    Bt2020Twelve: 15,
    Smpte2084: 16,
    Smpte428: 17,
    Hlg: 18
  };
  var MatrixCoefficients = {
    Identity: 0,
    Bt709: 1,
    Unspecified: 2,
    Fcc: 4,
    Bt470BG: 5,
    Bt601: 6,
    Smpte240: 7,
    YCgCo: 8,
    Bt2020Ncl: 9,
    Bt2020Cl: 10,
    Smpte2085: 11,
    ChromatNcl: 12,
    ChromatCl: 13,
    ICtCp: 14
  };
  var Av1 = class _Av1 extends BitReader {
    static ObuType = ObuType;
    static ColorPrimaries = ColorPrimaries;
    static TransferCharacteristics = TransferCharacteristics;
    static MatrixCoefficients = MatrixCoefficients;
    #Leb128Bytes = 0;
    uvlc() {
      let leadingZeros = 0;
      while (!this.f1()) {
        leadingZeros += 1;
      }
      if (leadingZeros >= 32) {
        return 2 ** 32 - 1;
      }
      const value = this.f(leadingZeros);
      return value + (1 << leadingZeros >>> 0) - 1;
    }
    leb128() {
      if (!this.byteAligned) {
        throw new Error("LEB128 must be byte-aligned");
      }
      let value = 0n;
      this.#Leb128Bytes = 0;
      for (let i = 0n; i < 8n; i += 1n) {
        const leb128_byte = this.f(8);
        value |= BigInt(leb128_byte & 127) << 7n * i;
        this.#Leb128Bytes += 1;
        if ((leb128_byte & 128) == 0) {
          break;
        }
      }
      return value;
    }
    *annexBBitstream() {
      while (!this.ended) {
        const temporal_unit_size = this.leb128();
        yield* this.temporalUnit(temporal_unit_size);
      }
    }
    *temporalUnit(sz) {
      while (sz > 0) {
        const frame_unit_size = this.leb128();
        sz -= BigInt(this.#Leb128Bytes);
        yield* this.frameUnit(frame_unit_size);
        sz -= frame_unit_size;
      }
    }
    *frameUnit(sz) {
      while (sz > 0) {
        const obu_length = this.leb128();
        sz -= BigInt(this.#Leb128Bytes);
        const obu = this.openBitstreamUnit(obu_length);
        if (obu) {
          yield obu;
        }
        sz -= obu_length;
      }
    }
    #OperatingPointIdc = 0;
    openBitstreamUnit(sz) {
      const obu_header = this.obuHeader();
      let obu_size;
      if (obu_header.obu_has_size_field) {
        obu_size = this.leb128();
      } else if (sz !== void 0) {
        obu_size = sz - 1n - (obu_header.obu_extension_flag ? 1n : 0n);
      } else {
        throw new Error("obu_has_size_field must be true");
      }
      const startPosition = this.getPosition();
      if (obu_header.obu_type !== _Av1.ObuType.SequenceHeader && obu_header.obu_type !== _Av1.ObuType.TemporalDelimiter && this.#OperatingPointIdc !== 0 && obu_header.obu_extension_header) {
        const inTemporalLayer = !!(this.#OperatingPointIdc & 1 << obu_header.obu_extension_header.temporal_id);
        const inSpatialLayer = !!(this.#OperatingPointIdc & 1 << obu_header.obu_extension_header.spatial_id + 8);
        if (!inTemporalLayer || !inSpatialLayer) {
          this.skip(Number(obu_size));
          return;
        }
      }
      let sequence_header_obu;
      switch (obu_header.obu_type) {
        case _Av1.ObuType.SequenceHeader:
          sequence_header_obu = this.sequenceHeaderObu();
          break;
      }
      const currentPosition = this.getPosition();
      const payloadBits = (currentPosition[0] - startPosition[0]) * 8 + (startPosition[1] - currentPosition[1]);
      if (obu_size > 0) {
        this.skip(Number(obu_size) * 8 - payloadBits);
      }
      return {
        obu_header,
        obu_size,
        sequence_header_obu
      };
    }
    obuHeader() {
      const obu_forbidden_bit = !!this.f1();
      if (obu_forbidden_bit) {
        throw new Error("Invalid data");
      }
      const obu_type = this.f(4);
      const obu_extension_flag = !!this.f1();
      const obu_has_size_field = !!this.f1();
      this.f1();
      let obu_extension_header;
      if (obu_extension_flag) {
        obu_extension_header = this.obuExtensionHeader();
      }
      return {
        obu_type,
        obu_extension_flag,
        obu_has_size_field,
        obu_extension_header
      };
    }
    obuExtensionHeader() {
      const temporal_id = this.f(3);
      const spatial_id = this.f(2);
      this.skip(3);
      return { temporal_id, spatial_id };
    }
    static SelectScreenContentTools = 2;
    static SelectIntegerMv = 2;
    sequenceHeaderObu() {
      const seq_profile = this.f(3);
      const still_picture = !!this.f1();
      const reduced_still_picture_header = !!this.f1();
      let timing_info_present_flag = false;
      let timing_info;
      let decoder_model_info_present_flag = false;
      let decoder_model_info;
      let initial_display_delay_present_flag = false;
      let operating_points_cnt_minus_1 = 0;
      const operating_point_idc = [];
      const seq_level_idx = [];
      const seq_tier = [];
      const decoder_model_present_for_this_op = [];
      const initial_display_delay_present_for_this_op = [];
      let operating_parameters_info;
      let initial_display_delay_minus_1;
      if (reduced_still_picture_header) {
        operating_point_idc[0] = 0;
        seq_level_idx[0] = this.f(5);
        seq_tier[0] = 0;
        decoder_model_present_for_this_op[0] = false;
        initial_display_delay_present_for_this_op[0] = false;
      } else {
        timing_info_present_flag = !!this.f1();
        if (timing_info_present_flag) {
          timing_info = this.timingInfo();
          decoder_model_info_present_flag = !!this.f1();
          if (decoder_model_info_present_flag) {
            decoder_model_info = this.decoderModelInfo();
            operating_parameters_info = [];
          }
        }
        initial_display_delay_present_flag = !!this.f1();
        if (initial_display_delay_present_flag) {
          initial_display_delay_minus_1 = [];
        }
        operating_points_cnt_minus_1 = this.f(5);
        for (let i = 0; i <= operating_points_cnt_minus_1; i += 1) {
          operating_point_idc[i] = this.f(12);
          seq_level_idx[i] = this.f(5);
          if (seq_level_idx[i] > 7) {
            seq_tier[i] = this.f1();
          } else {
            seq_tier[i] = 0;
          }
          if (decoder_model_info_present_flag) {
            decoder_model_present_for_this_op[i] = !!this.f1();
            if (decoder_model_present_for_this_op[i]) {
              operating_parameters_info[i] = this.operatingParametersInfo(decoder_model_info);
            }
          } else {
            decoder_model_present_for_this_op[i] = false;
          }
          if (initial_display_delay_present_flag) {
            initial_display_delay_present_for_this_op[i] = !!this.f1();
            if (initial_display_delay_present_for_this_op[i]) {
              initial_display_delay_minus_1[i] = this.f(4);
            }
          }
        }
      }
      const operatingPoint = this.chooseOperatingPoint();
      this.#OperatingPointIdc = operating_point_idc[operatingPoint];
      const frame_width_bits_minus_1 = this.f(4);
      const frame_height_bits_minus_1 = this.f(4);
      const max_frame_width_minus_1 = this.f(frame_width_bits_minus_1 + 1);
      const max_frame_height_minus_1 = this.f(frame_height_bits_minus_1 + 1);
      let frame_id_numbers_present_flag = false;
      let delta_frame_id_length_minus_2;
      let additional_frame_id_length_minus_1;
      if (!reduced_still_picture_header) {
        frame_id_numbers_present_flag = !!this.f1();
        if (frame_id_numbers_present_flag) {
          delta_frame_id_length_minus_2 = this.f(4);
          additional_frame_id_length_minus_1 = this.f(3);
        }
      }
      const use_128x128_superblock = !!this.f1();
      const enable_filter_intra = !!this.f1();
      const enable_intra_edge_filter = !!this.f1();
      let enable_interintra_compound = false;
      let enable_masked_compound = false;
      let enable_warped_motion = false;
      let enable_dual_filter = false;
      let enable_order_hint = false;
      let enable_jnt_comp = false;
      let enable_ref_frame_mvs = false;
      let seq_choose_screen_content_tools = false;
      let seq_force_screen_content_tools = _Av1.SelectScreenContentTools;
      let seq_choose_integer_mv = false;
      let seq_force_integer_mv = _Av1.SelectIntegerMv;
      let order_hint_bits_minus_1;
      if (!reduced_still_picture_header) {
        enable_interintra_compound = !!this.f1();
        enable_masked_compound = !!this.f1();
        enable_warped_motion = !!this.f1();
        enable_dual_filter = !!this.f1();
        enable_order_hint = !!this.f1();
        if (enable_order_hint) {
          enable_jnt_comp = !!this.f1();
          enable_ref_frame_mvs = !!this.f1();
        }
        seq_choose_screen_content_tools = !!this.f1();
        if (!seq_choose_screen_content_tools) {
          seq_force_screen_content_tools = this.f1();
        }
        if (seq_force_screen_content_tools > 0) {
          seq_choose_integer_mv = !!this.f1();
          if (!seq_choose_integer_mv) {
            seq_force_integer_mv = this.f1();
          }
        }
        if (enable_order_hint) {
          order_hint_bits_minus_1 = this.f(3);
        }
      }
      const enable_superres = !!this.f1();
      const enable_cdef = !!this.f1();
      const enable_restoration = !!this.f1();
      const color_config = this.colorConfig(seq_profile);
      const film_grain_params_present = !!this.f1();
      return {
        seq_profile,
        still_picture,
        reduced_still_picture_header,
        timing_info_present_flag,
        timing_info,
        decoder_model_info_present_flag,
        decoder_model_info,
        initial_display_delay_present_flag,
        initial_display_delay_minus_1,
        operating_points_cnt_minus_1,
        operating_point_idc,
        seq_level_idx,
        seq_tier,
        decoder_model_present_for_this_op,
        operating_parameters_info,
        initial_display_delay_present_for_this_op,
        frame_width_bits_minus_1,
        frame_height_bits_minus_1,
        max_frame_width_minus_1,
        max_frame_height_minus_1,
        frame_id_numbers_present_flag,
        delta_frame_id_length_minus_2,
        additional_frame_id_length_minus_1,
        use_128x128_superblock,
        enable_filter_intra,
        enable_intra_edge_filter,
        enable_interintra_compound,
        enable_masked_compound,
        enable_warped_motion,
        enable_dual_filter,
        enable_order_hint,
        enable_jnt_comp,
        enable_ref_frame_mvs,
        seq_choose_screen_content_tools,
        seq_force_screen_content_tools,
        seq_choose_integer_mv,
        seq_force_integer_mv,
        order_hint_bits_minus_1,
        enable_superres,
        enable_cdef,
        enable_restoration,
        color_config,
        film_grain_params_present
      };
    }
    searchSequenceHeaderObu() {
      while (!this.ended) {
        const obu = this.openBitstreamUnit();
        if (!obu) {
          continue;
        }
        if (obu.sequence_header_obu) {
          return obu.sequence_header_obu;
        }
      }
      return void 0;
    }
    timingInfo() {
      const num_units_in_display_tick = this.f(32);
      const time_scale = this.f(32);
      const equal_picture_interval = !!this.f1();
      let num_ticks_per_picture_minus_1;
      if (equal_picture_interval) {
        num_ticks_per_picture_minus_1 = this.uvlc();
      }
      return {
        num_units_in_display_tick,
        time_scale,
        equal_picture_interval,
        num_ticks_per_picture_minus_1
      };
    }
    decoderModelInfo() {
      const buffer_delay_length_minus_1 = this.f(5);
      const num_units_in_decoding_tick = this.f(32);
      const buffer_removal_time_length_minus_1 = this.f(5);
      const frame_presentation_time_length_minus_1 = this.f(5);
      return {
        buffer_delay_length_minus_1,
        num_units_in_decoding_tick,
        buffer_removal_time_length_minus_1,
        frame_presentation_time_length_minus_1
      };
    }
    operatingParametersInfo(decoderModelInfo) {
      const n = decoderModelInfo.buffer_delay_length_minus_1 + 1;
      const decoder_buffer_delay = this.f(n);
      const encoder_buffer_delay = this.f(n);
      const low_delay_mode_flag = !!this.f1();
      return {
        decoder_buffer_delay,
        encoder_buffer_delay,
        low_delay_mode_flag
      };
    }
    chooseOperatingPoint() {
      return 0;
    }
    colorConfig(seq_profile) {
      const high_bitdepth = !!this.f1();
      let twelve_bit = false;
      let BitDepth = 8;
      if (seq_profile === 2 && high_bitdepth) {
        twelve_bit = !!this.f1();
        BitDepth = twelve_bit ? 12 : 10;
      } else if (seq_profile <= 2) {
        BitDepth = high_bitdepth ? 10 : 8;
      }
      let mono_chrome = false;
      if (seq_profile === 1) {
        mono_chrome = !!this.f1();
      }
      const color_description_present_flag = !!this.f1();
      let color_primaries = _Av1.ColorPrimaries.Unspecified;
      let transfer_characteristics = _Av1.TransferCharacteristics.Unspecified;
      let matrix_coefficients = _Av1.MatrixCoefficients.Unspecified;
      if (color_description_present_flag) {
        color_primaries = this.f(8);
        transfer_characteristics = this.f(8);
        matrix_coefficients = this.f(8);
      }
      let color_range = false;
      let subsampling_x;
      let subsampling_y;
      let chroma_sample_position = 0;
      let separate_uv_delta_q = false;
      if (mono_chrome) {
        color_range = !!this.f1();
        subsampling_x = true;
        subsampling_y = true;
      } else {
        if (color_primaries === _Av1.ColorPrimaries.Bt709 && transfer_characteristics === _Av1.TransferCharacteristics.Srgb && matrix_coefficients === _Av1.MatrixCoefficients.Identity) {
          color_range = true;
          subsampling_x = false;
          subsampling_y = false;
        } else {
          color_range = !!this.f1();
          switch (seq_profile) {
            case 0:
              subsampling_x = true;
              subsampling_y = true;
              break;
            case 1:
              subsampling_x = false;
              subsampling_y = false;
              break;
            default:
              if (BitDepth == 12) {
                subsampling_x = !!this.f1();
                if (subsampling_x) {
                  subsampling_y = !!this.f1();
                } else {
                  subsampling_y = false;
                }
              } else {
                subsampling_x = true;
                subsampling_y = false;
              }
              break;
          }
          if (subsampling_x && subsampling_y) {
            chroma_sample_position = this.f(2);
          }
        }
        separate_uv_delta_q = !!this.f1();
      }
      return {
        high_bitdepth,
        twelve_bit,
        BitDepth,
        mono_chrome,
        color_description_present_flag,
        color_primaries,
        transfer_characteristics,
        matrix_coefficients,
        color_range,
        subsampling_x,
        subsampling_y,
        chroma_sample_position,
        separate_uv_delta_q
      };
    }
  };

  // node_modules/@yume-chan/scrcpy/esm/codec/nalu.js
  function* annexBSplitNalu(buffer) {
    let start = -1;
    let zeroCount = 0;
    let inEmulation = false;
    for (let i = 0; i < buffer.length; i += 1) {
      const byte = buffer[i];
      if (inEmulation) {
        if (byte > 3) {
          throw new Error("Invalid data");
        }
        inEmulation = false;
        continue;
      }
      if (byte === 0) {
        zeroCount += 1;
        continue;
      }
      const prevZeroCount = zeroCount;
      zeroCount = 0;
      if (start === -1) {
        if (prevZeroCount >= 2 && byte === 1) {
          start = i + 1;
          continue;
        }
        throw new Error("Invalid data");
      }
      if (prevZeroCount < 2) {
        continue;
      }
      if (byte === 1) {
        yield buffer.subarray(start, i - prevZeroCount);
        start = i + 1;
        continue;
      }
      if (prevZeroCount > 2) {
        throw new Error("Invalid data");
      }
      switch (byte) {
        case 2:
          throw new Error("Invalid data");
        case 3:
          inEmulation = true;
          break;
        default:
          break;
      }
    }
    if (inEmulation) {
      throw new Error("Invalid data");
    }
    yield buffer.subarray(start, buffer.length);
  }
  var NaluSodbBitReader = class {
    #nalu;
    // logical length is `#byteLength * 8 + (7 - #stopBitIndex)`
    #byteLength;
    #stopBitIndex;
    #zeroCount = 0;
    // logical position is `#bytePosition * 8 + (7 - #bitPosition)`
    #bytePosition = 0;
    #bitPosition = 7;
    #byte = 0;
    get byteLength() {
      return this.#byteLength;
    }
    get stopBitIndex() {
      return this.#stopBitIndex;
    }
    get bytePosition() {
      return this.#bytePosition;
    }
    get bitPosition() {
      return this.#bitPosition;
    }
    get ended() {
      return this.#bytePosition >= this.#byteLength && this.#bitPosition <= this.#stopBitIndex;
    }
    constructor(nalu) {
      this.#nalu = nalu;
      for (let i = nalu.length - 1; i >= 0; i -= 1) {
        if (this.#nalu[i] === 0) {
          continue;
        }
        const byte = nalu[i];
        for (let j = 0; j < 8; j += 1) {
          if ((byte >> j & 1) === 1) {
            this.#byteLength = i;
            this.#stopBitIndex = j;
            this.#loadByte();
            return;
          }
        }
      }
      throw new Error("Stop bit not found");
    }
    #loadByte() {
      this.#byte = this.#nalu[this.#bytePosition];
      if (this.#zeroCount === 2 && this.#byte === 3) {
        this.#zeroCount = 0;
        this.#bytePosition += 1;
        this.#loadByte();
        return;
      }
      if (this.#byte === 0) {
        this.#zeroCount += 1;
      } else {
        this.#zeroCount = 0;
      }
    }
    next() {
      if (this.ended) {
        throw new Error("Bit index out of bounds");
      }
      const value = this.#byte >> this.#bitPosition & 1;
      this.#bitPosition -= 1;
      if (this.#bitPosition < 0) {
        this.#bytePosition += 1;
        this.#bitPosition = 7;
        this.#loadByte();
      }
      return value;
    }
    read(length) {
      if (length > 32) {
        throw new Error("Read length too large");
      }
      let result = 0;
      for (let i = 0; i < length; i += 1) {
        result = result << 1 | this.next();
      }
      return result;
    }
    /**
     * Throws an error if the current position is invalid for `skip`.
     *
     * Usually it will throw if `ended` is `true`,
     * except when the bit position is at the stop bit,
     * in which case `ended` will be `true`, but it won't throw.
     * `skip` can skip all remaining bits, and stop at the end position.
     * The next `next` call will throw since there is no more bits to read.
     */
    #checkSkipPosition() {
      if (this.#bytePosition >= this.#byteLength && this.#bitPosition < this.#stopBitIndex) {
        throw new Error("Bit index out of bounds");
      }
    }
    skip(length) {
      if (length <= this.#bitPosition + 1) {
        this.#bitPosition -= length;
        this.#checkSkipPosition();
        return;
      }
      length -= this.#bitPosition + 1;
      this.#bytePosition += 1;
      this.#bitPosition = 7;
      this.#loadByte();
      this.#checkSkipPosition();
      for (; length >= 8; length -= 8) {
        this.#bytePosition += 1;
        this.#loadByte();
        this.#checkSkipPosition();
      }
      this.#bitPosition = 7 - length;
      this.#checkSkipPosition();
    }
    decodeExponentialGolombNumber() {
      let length = 0;
      while (this.next() === 0) {
        length += 1;
      }
      if (length === 0) {
        return 0;
      }
      return (1 << length | this.read(length)) - 1;
    }
    #save() {
      return {
        zeroCount: this.#zeroCount,
        bytePosition: this.#bytePosition,
        bitPosition: this.#bitPosition,
        byte: this.#byte
      };
    }
    #restore(state) {
      this.#zeroCount = state.zeroCount;
      this.#bytePosition = state.bytePosition;
      this.#bitPosition = state.bitPosition;
      this.#byte = state.byte;
    }
    peek(length) {
      const state = this.#save();
      const result = this.read(length);
      this.#restore(state);
      return result;
    }
    readBytes(length) {
      const result = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) {
        result[i] = this.read(8);
      }
      return result;
    }
    peekBytes(length) {
      const state = this.#save();
      const result = this.readBytes(length);
      this.#restore(state);
      return result;
    }
  };

  // node_modules/@yume-chan/scrcpy/esm/codec/h264.js
  var AndroidAvcProfile = {
    Baseline: 1 << 0,
    Main: 1 << 1,
    Extended: 1 << 2,
    High: 1 << 3,
    High10: 1 << 4,
    High422: 1 << 5,
    High444: 1 << 6,
    ConstrainedBaseline: 1 << 16,
    ConstrainedHigh: 1 << 19
  };
  var AndroidAvcLevel = {
    Level1: 1 << 0,
    Level1b: 1 << 1,
    Level11: 1 << 2,
    Level12: 1 << 3,
    Level13: 1 << 4,
    Level2: 1 << 5,
    Level21: 1 << 6,
    Level22: 1 << 7,
    Level3: 1 << 8,
    Level31: 1 << 9,
    Level32: 1 << 10,
    Level4: 1 << 11,
    Level41: 1 << 12,
    Level42: 1 << 13,
    Level5: 1 << 14,
    Level51: 1 << 15,
    Level52: 1 << 16,
    Level6: 1 << 17,
    Level61: 1 << 18,
    Level62: 1 << 19
  };
  function h264ParseSequenceParameterSet(nalu) {
    const reader = new NaluSodbBitReader(nalu);
    if (reader.next() !== 0) {
      throw new Error("Invalid data");
    }
    const nal_ref_idc = reader.read(2);
    const nal_unit_type = reader.read(5);
    if (nal_unit_type !== 7) {
      throw new Error("Invalid data");
    }
    if (nal_ref_idc === 0) {
      throw new Error("Invalid data");
    }
    const profile_idc = reader.read(8);
    const constraint_set = reader.peek(8);
    const constraint_set0_flag = !!reader.next();
    const constraint_set1_flag = !!reader.next();
    const constraint_set2_flag = !!reader.next();
    const constraint_set3_flag = !!reader.next();
    const constraint_set4_flag = !!reader.next();
    const constraint_set5_flag = !!reader.next();
    if (reader.read(2) !== 0) {
      throw new Error("Invalid data");
    }
    const level_idc = reader.read(8);
    const seq_parameter_set_id = reader.decodeExponentialGolombNumber();
    if (profile_idc === 100 || profile_idc === 110 || profile_idc === 122 || profile_idc === 244 || profile_idc === 44 || profile_idc === 83 || profile_idc === 86 || profile_idc === 118 || profile_idc === 128 || profile_idc === 138 || profile_idc === 139 || profile_idc === 134) {
      const chroma_format_idc = reader.decodeExponentialGolombNumber();
      if (chroma_format_idc === 3) {
        reader.next();
      }
      reader.decodeExponentialGolombNumber();
      reader.decodeExponentialGolombNumber();
      reader.next();
      const seq_scaling_matrix_present_flag = !!reader.next();
      if (seq_scaling_matrix_present_flag) {
        const seq_scaling_list_present_flag = [];
        for (let i = 0; i < (chroma_format_idc !== 3 ? 8 : 12); i += 1) {
          seq_scaling_list_present_flag[i] = !!reader.next();
          if (seq_scaling_list_present_flag[i])
            if (i < 6) {
            } else {
            }
        }
      }
    }
    reader.decodeExponentialGolombNumber();
    const pic_order_cnt_type = reader.decodeExponentialGolombNumber();
    if (pic_order_cnt_type === 0) {
      reader.decodeExponentialGolombNumber();
    } else if (pic_order_cnt_type === 1) {
      reader.next();
      reader.decodeExponentialGolombNumber();
      reader.decodeExponentialGolombNumber();
      const num_ref_frames_in_pic_order_cnt_cycle = reader.decodeExponentialGolombNumber();
      const offset_for_ref_frame = [];
      for (let i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i += 1) {
        offset_for_ref_frame[i] = reader.decodeExponentialGolombNumber();
      }
    }
    reader.decodeExponentialGolombNumber();
    reader.next();
    const pic_width_in_mbs_minus1 = reader.decodeExponentialGolombNumber();
    const pic_height_in_map_units_minus1 = reader.decodeExponentialGolombNumber();
    const frame_mbs_only_flag = reader.next();
    if (!frame_mbs_only_flag) {
      reader.next();
    }
    reader.next();
    const frame_cropping_flag = !!reader.next();
    let frame_crop_left_offset;
    let frame_crop_right_offset;
    let frame_crop_top_offset;
    let frame_crop_bottom_offset;
    if (frame_cropping_flag) {
      frame_crop_left_offset = reader.decodeExponentialGolombNumber();
      frame_crop_right_offset = reader.decodeExponentialGolombNumber();
      frame_crop_top_offset = reader.decodeExponentialGolombNumber();
      frame_crop_bottom_offset = reader.decodeExponentialGolombNumber();
    } else {
      frame_crop_left_offset = 0;
      frame_crop_right_offset = 0;
      frame_crop_top_offset = 0;
      frame_crop_bottom_offset = 0;
    }
    const vui_parameters_present_flag = !!reader.next();
    if (vui_parameters_present_flag) {
    }
    return {
      profile_idc,
      constraint_set,
      constraint_set0_flag,
      constraint_set1_flag,
      constraint_set2_flag,
      constraint_set3_flag,
      constraint_set4_flag,
      constraint_set5_flag,
      level_idc,
      seq_parameter_set_id,
      pic_width_in_mbs_minus1,
      pic_height_in_map_units_minus1,
      frame_mbs_only_flag,
      frame_cropping_flag,
      frame_crop_left_offset,
      frame_crop_right_offset,
      frame_crop_top_offset,
      frame_crop_bottom_offset
    };
  }
  function h264SearchConfiguration(buffer) {
    let sequenceParameterSet;
    let pictureParameterSet;
    for (const nalu of annexBSplitNalu(buffer)) {
      const naluType = nalu[0] & 31;
      switch (naluType) {
        case 7:
          sequenceParameterSet = nalu;
          if (pictureParameterSet) {
            return {
              sequenceParameterSet,
              pictureParameterSet
            };
          }
          break;
        case 8:
          pictureParameterSet = nalu;
          if (sequenceParameterSet) {
            return {
              sequenceParameterSet,
              pictureParameterSet
            };
          }
          break;
        default:
          break;
      }
    }
    throw new Error("Invalid data");
  }
  function h264ParseConfiguration(data) {
    const { sequenceParameterSet, pictureParameterSet } = h264SearchConfiguration(data);
    const { profile_idc: profileIndex, constraint_set: constraintSet, level_idc: levelIndex, pic_width_in_mbs_minus1, pic_height_in_map_units_minus1, frame_mbs_only_flag, frame_crop_left_offset, frame_crop_right_offset, frame_crop_top_offset, frame_crop_bottom_offset } = h264ParseSequenceParameterSet(sequenceParameterSet);
    const encodedWidth = (pic_width_in_mbs_minus1 + 1) * 16;
    const encodedHeight = (pic_height_in_map_units_minus1 + 1) * (2 - frame_mbs_only_flag) * 16;
    const cropLeft = frame_crop_left_offset * 2;
    const cropRight = frame_crop_right_offset * 2;
    const cropTop = frame_crop_top_offset * 2;
    const cropBottom = frame_crop_bottom_offset * 2;
    const croppedWidth = encodedWidth - cropLeft - cropRight;
    const croppedHeight = encodedHeight - cropTop - cropBottom;
    return {
      pictureParameterSet,
      sequenceParameterSet,
      profileIndex,
      constraintSet,
      levelIndex,
      encodedWidth,
      encodedHeight,
      cropLeft,
      cropRight,
      cropTop,
      cropBottom,
      croppedWidth,
      croppedHeight
    };
  }

  // node_modules/@yume-chan/scrcpy/esm/codec/h265.js
  var AndroidHevcProfile = {
    Main: 1 << 0,
    Main10: 1 << 1,
    MainStill: 1 << 2,
    Main10Hdr10: 1 << 12,
    Main10Hdr10Plus: 1 << 13
  };
  var AndroidHevcLevel = {
    MainTierLevel1: 1 << 0,
    HighTierLevel1: 1 << 1,
    MainTierLevel2: 1 << 2,
    HighTierLevel2: 1 << 3,
    MainTierLevel21: 1 << 4,
    HighTierLevel21: 1 << 5,
    MainTierLevel3: 1 << 6,
    HighTierLevel3: 1 << 7,
    MainTierLevel31: 1 << 8,
    HighTierLevel31: 1 << 9,
    MainTierLevel4: 1 << 10,
    HighTierLevel4: 1 << 11,
    MainTierLevel41: 1 << 12,
    HighTierLevel41: 1 << 13,
    MainTierLevel5: 1 << 14,
    HighTierLevel5: 1 << 15,
    MainTierLevel51: 1 << 16,
    HighTierLevel51: 1 << 17,
    MainTierLevel52: 1 << 18,
    HighTierLevel52: 1 << 19,
    MainTierLevel6: 1 << 20,
    HighTierLevel6: 1 << 21,
    MainTierLevel61: 1 << 22,
    HighTierLevel61: 1 << 23,
    MainTierLevel62: 1 << 24,
    HighTierLevel62: 1 << 25
  };
  function getSubWidthC(chroma_format_idc) {
    switch (chroma_format_idc) {
      case 0:
      case 3:
        return 1;
      case 1:
      case 2:
        return 2;
      default:
        throw new Error("Invalid chroma_format_idc");
    }
  }
  function getSubHeightC(chroma_format_idc) {
    switch (chroma_format_idc) {
      case 0:
      case 2:
      case 3:
        return 1;
      case 1:
        return 2;
      default:
        throw new Error("Invalid chroma_format_idc");
    }
  }
  function h265ParseNaluHeader(nalu) {
    const reader = new NaluSodbBitReader(nalu);
    if (reader.next() !== 0) {
      throw new Error("Invalid NALU header");
    }
    const nal_unit_type = reader.read(6);
    const nuh_layer_id = reader.read(6);
    const nuh_temporal_id_plus1 = reader.read(3);
    return {
      nal_unit_type,
      nuh_layer_id,
      nuh_temporal_id_plus1
    };
  }
  function h265ParseVideoParameterSet(nalu) {
    const reader = new NaluSodbBitReader(nalu);
    const vps_video_parameter_set_id = reader.read(4);
    const vps_base_layer_internal_flag = !!reader.next();
    const vps_base_layer_available_flag = !!reader.next();
    const vps_max_layers_minus1 = reader.read(6);
    const vps_max_sub_layers_minus1 = reader.read(3);
    const vps_temporal_id_nesting_flag = !!reader.next();
    reader.skip(16);
    const profileTierLevel = h265ParseProfileTierLevel(reader, true, vps_max_sub_layers_minus1);
    const vps_sub_layer_ordering_info_present_flag = !!reader.next();
    const vps_max_dec_pic_buffering_minus1 = [];
    const vps_max_num_reorder_pics = [];
    const vps_max_latency_increase_plus1 = [];
    for (let i = vps_sub_layer_ordering_info_present_flag ? 0 : vps_max_sub_layers_minus1; i <= vps_max_sub_layers_minus1; i += 1) {
      vps_max_dec_pic_buffering_minus1[i] = reader.decodeExponentialGolombNumber();
      vps_max_num_reorder_pics[i] = reader.decodeExponentialGolombNumber();
      vps_max_latency_increase_plus1[i] = reader.decodeExponentialGolombNumber();
    }
    const vps_max_layer_id = reader.read(6);
    const vps_num_layer_sets_minus1 = reader.decodeExponentialGolombNumber();
    const layer_id_included_flag = [];
    for (let i = 1; i <= vps_num_layer_sets_minus1; i += 1) {
      layer_id_included_flag[i] = [];
      for (let j = 0; j <= vps_max_layer_id; j += 1) {
        layer_id_included_flag[i][j] = !!reader.next();
      }
    }
    const vps_timing_info_present_flag = !!reader.next();
    let vps_num_units_in_tick;
    let vps_time_scale;
    let vps_poc_proportional_to_timing_flag;
    let vps_num_ticks_poc_diff_one_minus1;
    let vps_num_hrd_parameters;
    let hrd_layer_set_idx;
    let cprms_present_flag;
    let hrdParameters;
    if (vps_timing_info_present_flag) {
      vps_num_units_in_tick = reader.read(32);
      vps_time_scale = reader.read(32);
      vps_poc_proportional_to_timing_flag = !!reader.next();
      if (vps_poc_proportional_to_timing_flag) {
        vps_num_ticks_poc_diff_one_minus1 = reader.decodeExponentialGolombNumber();
      }
      vps_num_hrd_parameters = reader.decodeExponentialGolombNumber();
      hrd_layer_set_idx = [];
      cprms_present_flag = [true];
      hrdParameters = [];
      for (let i = 0; i < vps_num_hrd_parameters; i += 1) {
        hrd_layer_set_idx[i] = reader.decodeExponentialGolombNumber();
        if (i > 0) {
          cprms_present_flag[i] = !!reader.next();
        }
        hrdParameters[i] = h265ParseHrdParameters(reader, cprms_present_flag[i], vps_max_sub_layers_minus1);
      }
    }
    const vps_extension_flag = !!reader.next();
    return {
      vps_video_parameter_set_id,
      vps_base_layer_internal_flag,
      vps_base_layer_available_flag,
      vps_max_layers_minus1,
      vps_max_sub_layers_minus1,
      vps_temporal_id_nesting_flag,
      profileTierLevel,
      vps_sub_layer_ordering_info_present_flag,
      vps_max_dec_pic_buffering_minus1,
      vps_max_num_reorder_pics,
      vps_max_latency_increase_plus1,
      vps_max_layer_id,
      vps_num_layer_sets_minus1,
      layer_id_included_flag,
      vps_timing_info_present_flag,
      vps_num_units_in_tick,
      vps_time_scale,
      vps_poc_proportional_to_timing_flag,
      vps_num_ticks_poc_diff_one_minus1,
      vps_num_hrd_parameters,
      hrd_layer_set_idx,
      cprms_present_flag,
      hrdParameters,
      vps_extension_flag
    };
  }
  function h265ParseSequenceParameterSet(nalu) {
    const reader = new NaluSodbBitReader(nalu);
    const sps_video_parameter_set_id = reader.read(4);
    const sps_max_sub_layers_minus1 = reader.read(3);
    const sps_temporal_id_nesting_flag = !!reader.next();
    const profileTierLevel = h265ParseProfileTierLevel(reader, true, sps_max_sub_layers_minus1);
    const sps_seq_parameter_set_id = reader.decodeExponentialGolombNumber();
    const chroma_format_idc = reader.decodeExponentialGolombNumber();
    let separate_colour_plane_flag;
    if (chroma_format_idc === 3) {
      separate_colour_plane_flag = !!reader.next();
    }
    const pic_width_in_luma_samples = reader.decodeExponentialGolombNumber();
    const pic_height_in_luma_samples = reader.decodeExponentialGolombNumber();
    const conformance_window_flag = !!reader.next();
    let conf_win_left_offset;
    let conf_win_right_offset;
    let conf_win_top_offset;
    let conf_win_bottom_offset;
    if (conformance_window_flag) {
      conf_win_left_offset = reader.decodeExponentialGolombNumber();
      conf_win_right_offset = reader.decodeExponentialGolombNumber();
      conf_win_top_offset = reader.decodeExponentialGolombNumber();
      conf_win_bottom_offset = reader.decodeExponentialGolombNumber();
    }
    const bit_depth_luma_minus8 = reader.decodeExponentialGolombNumber();
    const bit_depth_chroma_minus8 = reader.decodeExponentialGolombNumber();
    const log2_max_pic_order_cnt_lsb_minus4 = reader.decodeExponentialGolombNumber();
    const sps_max_dec_pic_buffering_minus1 = [];
    const sps_max_num_reorder_pics = [];
    const sps_max_latency_increase_plus1 = [];
    const sps_sub_layer_ordering_info_present_flag = !!reader.next();
    for (let i = sps_sub_layer_ordering_info_present_flag ? 0 : sps_max_sub_layers_minus1; i <= sps_max_sub_layers_minus1; i += 1) {
      sps_max_dec_pic_buffering_minus1[i] = reader.decodeExponentialGolombNumber();
      sps_max_num_reorder_pics[i] = reader.decodeExponentialGolombNumber();
      sps_max_latency_increase_plus1[i] = reader.decodeExponentialGolombNumber();
    }
    const log2_min_luma_coding_block_size_minus3 = reader.decodeExponentialGolombNumber();
    const log2_diff_max_min_luma_coding_block_size = reader.decodeExponentialGolombNumber();
    const log2_min_luma_transform_block_size_minus2 = reader.decodeExponentialGolombNumber();
    const log2_diff_max_min_luma_transform_block_size = reader.decodeExponentialGolombNumber();
    const max_transform_hierarchy_depth_inter = reader.decodeExponentialGolombNumber();
    const max_transform_hierarchy_depth_intra = reader.decodeExponentialGolombNumber();
    const scaling_list_enabled_flag = !!reader.next();
    let sps_scaling_list_data_present_flag;
    let scalingListData;
    if (scaling_list_enabled_flag) {
      sps_scaling_list_data_present_flag = !!reader.next();
      if (sps_scaling_list_data_present_flag) {
        scalingListData = h265ParseScalingListData(reader);
      }
    }
    const amp_enabled_flag = !!reader.next();
    const sample_adaptive_offset_enabled_flag = !!reader.next();
    const pcm_enabled_flag = !!reader.next();
    let pcm_sample_bit_depth_luma_minus1;
    let pcm_sample_bit_depth_chroma_minus1;
    let log2_min_pcm_luma_coding_block_size_minus3;
    let log2_diff_max_min_pcm_luma_coding_block_size;
    let pcm_loop_filter_disabled_flag;
    if (pcm_enabled_flag) {
      pcm_sample_bit_depth_luma_minus1 = reader.read(4);
      pcm_sample_bit_depth_chroma_minus1 = reader.read(4);
      log2_min_pcm_luma_coding_block_size_minus3 = reader.decodeExponentialGolombNumber();
      log2_diff_max_min_pcm_luma_coding_block_size = reader.decodeExponentialGolombNumber();
      pcm_loop_filter_disabled_flag = !!reader.next();
    }
    const num_short_term_ref_pic_sets = reader.decodeExponentialGolombNumber();
    const shortTermRefPicSets = [];
    for (let i = 0; i < num_short_term_ref_pic_sets; i += 1) {
      shortTermRefPicSets[i] = h265ParseShortTermReferencePictureSet(reader, i, num_short_term_ref_pic_sets, shortTermRefPicSets);
    }
    const long_term_ref_pics_present_flag = !!reader.next();
    let num_long_term_ref_pics_sps;
    let lt_ref_pic_poc_lsb_sps;
    let used_by_curr_pic_lt_sps_flag;
    if (long_term_ref_pics_present_flag) {
      num_long_term_ref_pics_sps = reader.decodeExponentialGolombNumber();
      lt_ref_pic_poc_lsb_sps = [];
      used_by_curr_pic_lt_sps_flag = [];
      for (let i = 0; i < num_long_term_ref_pics_sps; i += 1) {
        lt_ref_pic_poc_lsb_sps[i] = reader.read(log2_max_pic_order_cnt_lsb_minus4 + 4);
        used_by_curr_pic_lt_sps_flag[i] = !!reader.next();
      }
    }
    const sps_temporal_mvp_enabled_flag = !!reader.next();
    const strong_intra_smoothing_enabled_flag = !!reader.next();
    const vui_parameters_present_flag = !!reader.next();
    let vuiParameters;
    if (vui_parameters_present_flag) {
      vuiParameters = h265ParseVuiParameters(reader, sps_max_sub_layers_minus1);
    }
    const sps_extension_present_flag = !!reader.next();
    let sps_range_extension_flag;
    let sps_multilayer_extension_flag;
    let sps_3d_extension_flag;
    let sps_scc_extension_flag;
    let sps_extension_4bits;
    if (sps_extension_present_flag) {
      sps_range_extension_flag = !!reader.next();
      sps_multilayer_extension_flag = !!reader.next();
      sps_3d_extension_flag = !!reader.next();
      sps_scc_extension_flag = !!reader.next();
      sps_extension_4bits = reader.read(4);
    }
    if (sps_range_extension_flag) {
      throw new Error("Not implemented");
    }
    let spsMultilayerExtension;
    if (sps_multilayer_extension_flag) {
      spsMultilayerExtension = h265ParseSpsMultilayerExtension(reader);
    }
    let sps3dExtension;
    if (sps_3d_extension_flag) {
      sps3dExtension = h265ParseSps3dExtension(reader);
    }
    if (sps_scc_extension_flag) {
      throw new Error("Not implemented");
    }
    let sps_extension_data_flag;
    if (sps_extension_4bits) {
      sps_extension_data_flag = [];
      let i = 0;
      while (!reader.ended) {
        sps_extension_data_flag[i] = !!reader.next();
        i += 1;
      }
    }
    return {
      sps_video_parameter_set_id,
      sps_max_sub_layers_minus1,
      sps_temporal_id_nesting_flag,
      profileTierLevel,
      sps_seq_parameter_set_id,
      chroma_format_idc,
      separate_colour_plane_flag,
      pic_width_in_luma_samples,
      pic_height_in_luma_samples,
      conformance_window_flag,
      conf_win_left_offset,
      conf_win_right_offset,
      conf_win_top_offset,
      conf_win_bottom_offset,
      bit_depth_luma_minus8,
      bit_depth_chroma_minus8,
      log2_max_pic_order_cnt_lsb_minus4,
      sps_sub_layer_ordering_info_present_flag,
      sps_max_dec_pic_buffering_minus1,
      sps_max_num_reorder_pics,
      sps_max_latency_increase_plus1,
      log2_min_luma_coding_block_size_minus3,
      log2_diff_max_min_luma_coding_block_size,
      log2_min_luma_transform_block_size_minus2,
      log2_diff_max_min_luma_transform_block_size,
      max_transform_hierarchy_depth_inter,
      max_transform_hierarchy_depth_intra,
      scaling_list_enabled_flag,
      sps_scaling_list_data_present_flag,
      scalingListData,
      amp_enabled_flag,
      sample_adaptive_offset_enabled_flag,
      pcm_enabled_flag,
      pcm_sample_bit_depth_luma_minus1,
      pcm_sample_bit_depth_chroma_minus1,
      log2_min_pcm_luma_coding_block_size_minus3,
      log2_diff_max_min_pcm_luma_coding_block_size,
      pcm_loop_filter_disabled_flag,
      num_short_term_ref_pic_sets,
      shortTermRefPicSets,
      long_term_ref_pics_present_flag,
      num_long_term_ref_pics_sps,
      lt_ref_pic_poc_lsb_sps,
      used_by_curr_pic_lt_sps_flag,
      sps_temporal_mvp_enabled_flag,
      strong_intra_smoothing_enabled_flag,
      vui_parameters_present_flag,
      vuiParameters,
      sps_extension_present_flag,
      sps_range_extension_flag,
      sps_multilayer_extension_flag,
      sps_3d_extension_flag,
      sps_scc_extension_flag,
      sps_extension_4bits,
      spsMultilayerExtension,
      sps3dExtension,
      sps_extension_data_flag
    };
  }
  function h265ParseProfileTier(reader) {
    const profile_space = reader.read(2);
    const tier_flag = !!reader.next();
    const profile_idc = reader.read(5);
    const profileCompatibilitySet = reader.peekBytes(4);
    const profile_compatibility_flag = [];
    for (let j = 0; j < 32; j += 1) {
      profile_compatibility_flag[j] = !!reader.next();
    }
    const constraintSet = reader.peekBytes(6);
    const progressive_source_flag = !!reader.next();
    const interlaced_source_flag = !!reader.next();
    const non_packed_constraint_flag = !!reader.next();
    const frame_only_constraint_flag = !!reader.next();
    let max_12bit_constraint_flag;
    let max_10bit_constraint_flag;
    let max_8bit_constraint_flag;
    let max_422chroma_constraint_flag;
    let max_420chroma_constraint_flag;
    let max_monochrome_constraint_flag;
    let intra_constraint_flag;
    let one_picture_only_constraint_flag;
    let lower_bit_rate_constraint_flag;
    let max_14bit_constraint_flag;
    if (profile_idc === 4 || profile_compatibility_flag[4] || profile_idc === 5 || profile_compatibility_flag[5] || profile_idc === 6 || profile_compatibility_flag[6] || profile_idc === 7 || profile_compatibility_flag[7] || profile_idc === 8 || profile_compatibility_flag[8] || profile_idc === 9 || profile_compatibility_flag[9] || profile_idc === 10 || profile_compatibility_flag[10] || profile_idc === 11 || profile_compatibility_flag[11]) {
      max_12bit_constraint_flag = !!reader.next();
      max_10bit_constraint_flag = !!reader.next();
      max_8bit_constraint_flag = !!reader.next();
      max_422chroma_constraint_flag = !!reader.next();
      max_420chroma_constraint_flag = !!reader.next();
      max_monochrome_constraint_flag = !!reader.next();
      intra_constraint_flag = !!reader.next();
      one_picture_only_constraint_flag = !!reader.next();
      lower_bit_rate_constraint_flag = !!reader.next();
      if (profile_idc === 5 || profile_compatibility_flag[5] || profile_idc === 9 || profile_compatibility_flag[9] || profile_idc === 10 || profile_compatibility_flag[10] || profile_idc === 11 || profile_compatibility_flag[11]) {
        max_14bit_constraint_flag = !!reader.next();
        reader.skip(33);
      } else {
        reader.skip(34);
      }
    } else if (profile_idc === 2 || profile_compatibility_flag[2]) {
      reader.skip(7);
      one_picture_only_constraint_flag = !!reader.next();
      reader.skip(35);
    } else {
      reader.skip(43);
    }
    let inbld_flag;
    if (profile_idc === 1 || profile_compatibility_flag[1] || profile_idc === 2 || profile_compatibility_flag[2] || profile_idc === 3 || profile_compatibility_flag[3] || profile_idc === 4 || profile_compatibility_flag[4] || profile_idc === 5 || profile_compatibility_flag[5] || profile_idc === 9 || profile_compatibility_flag[9] || profile_idc === 11 || profile_compatibility_flag[11]) {
      inbld_flag = !!reader.next();
    } else {
      reader.skip(1);
    }
    return {
      profile_space,
      tier_flag,
      profile_idc,
      profileCompatibilitySet,
      profile_compatibility_flag,
      constraintSet,
      progressive_source_flag,
      interlaced_source_flag,
      non_packed_constraint_flag,
      frame_only_constraint_flag,
      max_12bit_constraint_flag,
      max_10bit_constraint_flag,
      max_8bit_constraint_flag,
      max_422chroma_constraint_flag,
      max_420chroma_constraint_flag,
      max_monochrome_constraint_flag,
      intra_constraint_flag,
      one_picture_only_constraint_flag,
      lower_bit_rate_constraint_flag,
      max_14bit_constraint_flag,
      inbld_flag
    };
  }
  function h265ParseProfileTierLevel(reader, profilePresentFlag, maxNumSubLayersMinus1) {
    let generalProfileTier;
    if (profilePresentFlag) {
      generalProfileTier = h265ParseProfileTier(reader);
    }
    const general_level_idc = reader.read(8);
    const sub_layer_profile_present_flag = [];
    const sub_layer_level_present_flag = [];
    for (let i = 0; i < maxNumSubLayersMinus1; i += 1) {
      sub_layer_profile_present_flag[i] = !!reader.next();
      sub_layer_level_present_flag[i] = !!reader.next();
    }
    if (maxNumSubLayersMinus1 > 0) {
      for (let i = maxNumSubLayersMinus1; i < 8; i += 1) {
        reader.read(2);
      }
    }
    const subLayerProfileTier = [];
    const sub_layer_level_idc = [];
    for (let i = 0; i < maxNumSubLayersMinus1; i += 1) {
      if (sub_layer_profile_present_flag[i]) {
        subLayerProfileTier[i] = h265ParseProfileTier(reader);
      }
      if (sub_layer_level_present_flag[i]) {
        sub_layer_level_idc[i] = reader.read(8);
      }
    }
    return {
      generalProfileTier,
      general_level_idc,
      sub_layer_profile_present_flag,
      sub_layer_level_present_flag,
      subLayerProfileTier,
      sub_layer_level_idc
    };
  }
  function h265ParseScalingListData(reader) {
    const scaling_list = [];
    for (let sizeId = 0; sizeId < 4; sizeId += 1) {
      scaling_list[sizeId] = [];
      for (let matrixId = 0; matrixId < 6; matrixId += sizeId === 3 ? 3 : 1) {
        const scaling_list_pred_mode_flag = !!reader.next();
        if (!scaling_list_pred_mode_flag) {
          reader.decodeExponentialGolombNumber();
        } else {
          let nextCoef = 8;
          const coefNum = Math.min(64, 1 << 4 + (sizeId << 1));
          if (sizeId > 1) {
            const scaling_list_dc_coef_minus8 = reader.decodeExponentialGolombNumber();
            nextCoef = scaling_list_dc_coef_minus8 + 8;
          }
          scaling_list[sizeId][matrixId] = [];
          for (let i = 0; i < coefNum; i += 1) {
            const scaling_list_delta_coef = reader.decodeExponentialGolombNumber();
            nextCoef = (nextCoef + scaling_list_delta_coef + 256) % 256;
            scaling_list[sizeId][matrixId][i] = nextCoef;
          }
        }
      }
    }
    return scaling_list;
  }
  function h265ParseShortTermReferencePictureSet(reader, stRpsIdx, num_short_term_ref_pic_sets, sets) {
    let inter_ref_pic_set_prediction_flag = false;
    if (stRpsIdx !== 0) {
      inter_ref_pic_set_prediction_flag = !!reader.next();
    }
    let delta_idx_minus1 = 0;
    let delta_rps_sign = false;
    let abs_delta_rps_minus1 = 0;
    const used_by_curr_pic_flag = [];
    const use_delta_flag = [];
    let num_negative_pics = 0;
    let num_positive_pics = 0;
    const delta_poc_s0_minus1 = [];
    const used_by_curr_pic_s0_flag = [];
    const delta_poc_s1_minus1 = [];
    const used_by_curr_pic_s1_flag = [];
    if (inter_ref_pic_set_prediction_flag) {
      if (stRpsIdx === num_short_term_ref_pic_sets) {
        delta_idx_minus1 = reader.decodeExponentialGolombNumber();
      }
      delta_rps_sign = !!reader.next();
      abs_delta_rps_minus1 = reader.decodeExponentialGolombNumber();
      const RefRpsIdx = stRpsIdx - (delta_idx_minus1 + 1);
      const RefRps = sets[RefRpsIdx];
      const NumDeltaPocs_RefRpsIdx = RefRps.num_negative_pics + RefRps.num_positive_pics;
      for (let j = 0; j <= NumDeltaPocs_RefRpsIdx; j += 1) {
        used_by_curr_pic_flag[j] = !!reader.next();
        if (!used_by_curr_pic_flag[j]) {
          use_delta_flag[j] = !!reader.next();
        } else {
          use_delta_flag[j] = true;
        }
      }
      const DeltaRps = (1 - 2 * Number(delta_rps_sign)) * (abs_delta_rps_minus1 + 1);
      const RefPocS0 = [];
      const RefPocS1 = [];
      const pocS0 = [];
      const pocS1 = [];
      let dPoc = 0;
      for (let i2 = 0; i2 < RefRps.num_negative_pics; i2 += 1) {
        dPoc -= RefRps.delta_poc_s0_minus1[i2] + 1;
        RefPocS0[i2] = dPoc;
      }
      dPoc = 0;
      for (let i2 = 0; i2 < RefRps.num_positive_pics; i2 += 1) {
        dPoc += RefRps.delta_poc_s1_minus1[i2] + 1;
        RefPocS1[i2] = dPoc;
      }
      let i = 0;
      if (RefRps.num_positive_pics > 0) {
        for (let j = RefRps.num_positive_pics - 1; j >= 0; j -= 1) {
          dPoc = RefPocS1[j] + DeltaRps;
          if (dPoc < 0 && use_delta_flag[RefRps.num_negative_pics + j]) {
            pocS0[i] = dPoc;
            used_by_curr_pic_s0_flag[i] = used_by_curr_pic_flag[RefRps.num_negative_pics + j];
            i += 1;
          }
        }
      }
      if (DeltaRps < 0 && use_delta_flag[NumDeltaPocs_RefRpsIdx]) {
        pocS0[i] = DeltaRps;
        used_by_curr_pic_s0_flag[i] = used_by_curr_pic_flag[NumDeltaPocs_RefRpsIdx];
        i += 1;
      }
      for (let j = 0; j < RefRps.num_negative_pics; j += 1) {
        dPoc = RefPocS0[j] + DeltaRps;
        if (dPoc < 0 && use_delta_flag[j]) {
          pocS0[i] = dPoc;
          used_by_curr_pic_s0_flag[i] = used_by_curr_pic_flag[j];
          i += 1;
        }
      }
      num_negative_pics = i;
      let prev = 0;
      for (i = 0; i < num_negative_pics; i += 1) {
        const current = pocS0[i];
        delta_poc_s0_minus1[i] = -(current - prev - 1);
        prev = current;
      }
      i = 0;
      if (RefRps.num_negative_pics > 0) {
        for (let j = RefRps.num_negative_pics - 1; j >= 0; j -= 1) {
          dPoc = RefPocS0[j] + DeltaRps;
          if (dPoc > 0 && use_delta_flag[j]) {
            pocS1[i] = dPoc;
            used_by_curr_pic_s1_flag[i] = used_by_curr_pic_flag[j];
            i += 1;
          }
        }
      }
      if (DeltaRps > 0 && use_delta_flag[NumDeltaPocs_RefRpsIdx]) {
        pocS1[i] = DeltaRps;
        used_by_curr_pic_s1_flag[i] = used_by_curr_pic_flag[NumDeltaPocs_RefRpsIdx];
        i += 1;
      }
      for (let j = 0; j < RefRps.num_positive_pics; j += 1) {
        dPoc = RefPocS1[j] + DeltaRps;
        if (dPoc > 0 && use_delta_flag[RefRps.num_negative_pics + j]) {
          pocS1[i] = dPoc;
          used_by_curr_pic_s1_flag[i] = used_by_curr_pic_flag[RefRps.num_negative_pics + j];
          i += 1;
        }
      }
      num_positive_pics = i;
      prev = 0;
      for (i = 0; i < num_positive_pics; i += 1) {
        const current = pocS1[i];
        delta_poc_s1_minus1[i] = current - prev - 1;
        prev = current;
      }
    } else {
      num_negative_pics = reader.decodeExponentialGolombNumber();
      num_positive_pics = reader.decodeExponentialGolombNumber();
      for (let i = 0; i < num_negative_pics; i += 1) {
        delta_poc_s0_minus1[i] = reader.decodeExponentialGolombNumber();
        used_by_curr_pic_s0_flag[i] = !!reader.next();
      }
      for (let i = 0; i < num_positive_pics; i += 1) {
        delta_poc_s1_minus1[i] = reader.decodeExponentialGolombNumber();
        used_by_curr_pic_s1_flag[i] = !!reader.next();
      }
    }
    return {
      stRpsIdx,
      num_short_term_ref_pic_sets,
      inter_ref_pic_set_prediction_flag,
      delta_idx_minus1,
      delta_rps_sign,
      abs_delta_rps_minus1,
      used_by_curr_pic_flag,
      use_delta_flag,
      num_negative_pics,
      num_positive_pics,
      delta_poc_s0_minus1,
      used_by_curr_pic_s0_flag,
      delta_poc_s1_minus1,
      used_by_curr_pic_s1_flag
    };
  }
  var H265AspectRatioIndicator = {
    Unspecified: 0,
    Square: 1,
    _12_11: 2,
    _10_11: 3,
    _16_11: 4,
    _40_33: 5,
    _24_11: 6,
    _20_11: 7,
    _32_11: 8,
    _80_33: 9,
    _18_11: 10,
    _15_11: 11,
    _64_33: 12,
    _160_99: 13,
    _4_3: 15,
    _3_2: 16,
    _2_1: 17,
    Extended: 255
  };
  function h265ParseVuiParameters(reader, sps_max_sub_layers_minus1) {
    const aspect_ratio_info_present_flag = !!reader.next();
    let aspect_ratio_idc;
    let sar_width;
    let sar_height;
    if (aspect_ratio_info_present_flag) {
      aspect_ratio_idc = reader.read(8);
      if (aspect_ratio_idc === H265AspectRatioIndicator.Extended) {
        sar_width = reader.read(16);
        sar_height = reader.read(16);
      }
    }
    const overscan_info_present_flag = !!reader.next();
    let overscan_appropriate_flag;
    if (overscan_info_present_flag) {
      overscan_appropriate_flag = !!reader.next();
    }
    const video_signal_type_present_flag = !!reader.next();
    let video_format;
    let video_full_range_flag;
    let colour_description_present_flag;
    let colour_primaries;
    let transfer_characteristics;
    let matrix_coeffs;
    if (video_signal_type_present_flag) {
      video_format = reader.read(3);
      video_full_range_flag = !!reader.next();
      colour_description_present_flag = !!reader.next();
      if (colour_description_present_flag) {
        colour_primaries = reader.read(8);
        transfer_characteristics = reader.read(8);
        matrix_coeffs = reader.read(8);
      }
    }
    const chroma_loc_info_present_flag = !!reader.next();
    let chroma_sample_loc_type_top_field;
    let chroma_sample_loc_type_bottom_field;
    if (chroma_loc_info_present_flag) {
      chroma_sample_loc_type_top_field = reader.decodeExponentialGolombNumber();
      chroma_sample_loc_type_bottom_field = reader.decodeExponentialGolombNumber();
    }
    const neutral_chroma_indication_flag = !!reader.next();
    const field_seq_flag = !!reader.next();
    const frame_field_info_present_flag = !!reader.next();
    const default_display_window_flag = !!reader.next();
    let def_disp_win_left_offset;
    let def_disp_win_right_offset;
    let def_disp_win_top_offset;
    let def_disp_win_bottom_offset;
    if (default_display_window_flag) {
      def_disp_win_left_offset = reader.decodeExponentialGolombNumber();
      def_disp_win_right_offset = reader.decodeExponentialGolombNumber();
      def_disp_win_top_offset = reader.decodeExponentialGolombNumber();
      def_disp_win_bottom_offset = reader.decodeExponentialGolombNumber();
    }
    const vui_timing_info_present_flag = !!reader.next();
    let vui_num_units_in_tick;
    let vui_time_scale;
    let vui_poc_proportional_to_timing_flag;
    let vui_num_ticks_poc_diff_one_minus1;
    let vui_hrd_parameters_present_flag;
    let vui_hrd_parameters;
    if (vui_timing_info_present_flag) {
      vui_num_units_in_tick = reader.read(32);
      vui_time_scale = reader.read(32);
      vui_poc_proportional_to_timing_flag = !!reader.next();
      if (vui_poc_proportional_to_timing_flag) {
        vui_num_ticks_poc_diff_one_minus1 = reader.decodeExponentialGolombNumber();
      }
      vui_hrd_parameters_present_flag = !!reader.next();
      if (vui_hrd_parameters_present_flag) {
        vui_hrd_parameters = h265ParseHrdParameters(reader, true, sps_max_sub_layers_minus1);
      }
    }
    const bitstream_restriction_flag = !!reader.next();
    let tiles_fixed_structure_flag;
    let motion_vectors_over_pic_boundaries_flag;
    let restricted_ref_pic_lists_flag;
    let min_spatial_segmentation_idc;
    let max_bytes_per_pic_denom;
    let max_bits_per_min_cu_denom;
    let log2_max_mv_length_horizontal;
    let log2_max_mv_length_vertical;
    if (bitstream_restriction_flag) {
      tiles_fixed_structure_flag = !!reader.next();
      motion_vectors_over_pic_boundaries_flag = !!reader.next();
      restricted_ref_pic_lists_flag = !!reader.next();
      min_spatial_segmentation_idc = reader.decodeExponentialGolombNumber();
      max_bytes_per_pic_denom = reader.decodeExponentialGolombNumber();
      max_bits_per_min_cu_denom = reader.decodeExponentialGolombNumber();
      log2_max_mv_length_horizontal = reader.decodeExponentialGolombNumber();
      log2_max_mv_length_vertical = reader.decodeExponentialGolombNumber();
    }
    return {
      aspect_ratio_info_present_flag,
      aspect_ratio_idc,
      sar_width,
      sar_height,
      overscan_info_present_flag,
      overscan_appropriate_flag,
      video_signal_type_present_flag,
      video_format,
      video_full_range_flag,
      colour_description_present_flag,
      colour_primaries,
      transfer_characteristics,
      matrix_coeffs,
      chroma_loc_info_present_flag,
      chroma_sample_loc_type_top_field,
      chroma_sample_loc_type_bottom_field,
      neutral_chroma_indication_flag,
      field_seq_flag,
      frame_field_info_present_flag,
      default_display_window_flag,
      def_disp_win_left_offset,
      def_disp_win_right_offset,
      def_disp_win_top_offset,
      def_disp_win_bottom_offset,
      vui_timing_info_present_flag,
      vui_num_units_in_tick,
      vui_time_scale,
      vui_poc_proportional_to_timing_flag,
      vui_num_ticks_poc_diff_one_minus1,
      vui_hrd_parameters_present_flag,
      vui_hrd_parameters,
      bitstream_restriction_flag,
      tiles_fixed_structure_flag,
      motion_vectors_over_pic_boundaries_flag,
      restricted_ref_pic_lists_flag,
      min_spatial_segmentation_idc,
      max_bytes_per_pic_denom,
      max_bits_per_min_cu_denom,
      log2_max_mv_length_horizontal,
      log2_max_mv_length_vertical
    };
  }
  function h265ParseHrdParameters(reader, commonInfPresentFlag, maxNumSubLayersMinus1) {
    let nal_hrd_parameters_present_flag;
    let vcl_hrd_parameters_present_flag;
    let sub_pic_hrd_params_present_flag;
    let tick_divisor_minus2;
    let du_cpb_removal_delay_increment_length_minus1;
    let sub_pic_cpb_params_in_pic_timing_sei_flag;
    let dpb_output_delay_du_length_minus1;
    let bit_rate_scale;
    let cpb_size_scale;
    let cpb_size_du_scale;
    let initial_cpb_removal_delay_length_minus1;
    let au_cpb_removal_delay_length_minus1;
    let dpb_output_delay_length_minus1;
    if (commonInfPresentFlag) {
      nal_hrd_parameters_present_flag = !!reader.next();
      vcl_hrd_parameters_present_flag = !!reader.next();
      if (nal_hrd_parameters_present_flag || vcl_hrd_parameters_present_flag) {
        sub_pic_hrd_params_present_flag = !!reader.next();
        if (sub_pic_hrd_params_present_flag) {
          tick_divisor_minus2 = reader.read(8);
          du_cpb_removal_delay_increment_length_minus1 = reader.read(5);
          sub_pic_cpb_params_in_pic_timing_sei_flag = !!reader.next();
          dpb_output_delay_du_length_minus1 = reader.read(5);
        }
        bit_rate_scale = reader.read(4);
        cpb_size_scale = reader.read(4);
        if (sub_pic_hrd_params_present_flag) {
          cpb_size_du_scale = reader.read(4);
        }
        initial_cpb_removal_delay_length_minus1 = reader.read(5);
        au_cpb_removal_delay_length_minus1 = reader.read(5);
        dpb_output_delay_length_minus1 = reader.read(5);
      }
    }
    const fixed_pic_rate_general_flag = [];
    const fixed_pic_rate_within_cvs_flag = [];
    const elemental_duration_in_tc_minus1 = [];
    const low_delay_hrd_flag = [];
    const cpb_cnt_minus1 = [];
    const nalHrdParameters = [];
    const vclHrdParameters = [];
    for (let i = 0; i <= maxNumSubLayersMinus1; i += 1) {
      fixed_pic_rate_general_flag[i] = !!reader.next();
      if (!fixed_pic_rate_general_flag[i]) {
        fixed_pic_rate_within_cvs_flag[i] = !!reader.next();
      }
      if (fixed_pic_rate_within_cvs_flag[i]) {
        elemental_duration_in_tc_minus1[i] = reader.decodeExponentialGolombNumber();
      } else {
        low_delay_hrd_flag[i] = !!reader.next();
      }
      if (!low_delay_hrd_flag[i]) {
        cpb_cnt_minus1[i] = reader.decodeExponentialGolombNumber();
      }
      if (nal_hrd_parameters_present_flag) {
        nalHrdParameters[i] = h265ParseSubLayerHrdParameters(reader, i, getCpbCnt(cpb_cnt_minus1[i]));
      }
      if (vcl_hrd_parameters_present_flag) {
        vclHrdParameters[i] = h265ParseSubLayerHrdParameters(reader, i, getCpbCnt(cpb_cnt_minus1[i]));
      }
    }
    return {
      nal_hrd_parameters_present_flag,
      vcl_hrd_parameters_present_flag,
      sub_pic_hrd_params_present_flag,
      tick_divisor_minus2,
      du_cpb_removal_delay_increment_length_minus1,
      sub_pic_cpb_params_in_pic_timing_sei_flag,
      dpb_output_delay_du_length_minus1,
      bit_rate_scale,
      cpb_size_scale,
      cpb_size_du_scale,
      initial_cpb_removal_delay_length_minus1,
      au_cpb_removal_delay_length_minus1,
      dpb_output_delay_length_minus1,
      fixed_pic_rate_general_flag,
      fixed_pic_rate_within_cvs_flag,
      elemental_duration_in_tc_minus1,
      low_delay_hrd_flag,
      cpb_cnt_minus1,
      nalHrdParameters,
      vclHrdParameters
    };
  }
  function h265ParseSubLayerHrdParameters(reader, subLayerId, CpbCnt) {
    const bit_rate_value_minus1 = [];
    const cpb_size_value_minus1 = [];
    const cpb_size_du_value_minus1 = [];
    const bit_rate_du_value_minus1 = [];
    const cbr_flag = [];
    for (let i = 0; i < CpbCnt; i += 1) {
      bit_rate_value_minus1[i] = reader.decodeExponentialGolombNumber();
      cpb_size_value_minus1[i] = reader.decodeExponentialGolombNumber();
      if (subLayerId > 0) {
        cbr_flag[i] = !!reader.next();
      }
    }
    return {
      bit_rate_value_minus1,
      cpb_size_value_minus1,
      cpb_size_du_value_minus1,
      bit_rate_du_value_minus1,
      cbr_flag
    };
  }
  function getCpbCnt(cpb_cnt_minus_1) {
    return cpb_cnt_minus_1 + 1;
  }
  function h265SearchConfiguration(buffer) {
    let videoParameterSet;
    let sequenceParameterSet;
    let pictureParameterSet;
    let count = 0;
    for (const nalu of annexBSplitNalu(buffer)) {
      const header = h265ParseNaluHeader(nalu);
      const raw = {
        ...header,
        data: nalu,
        rbsp: nalu.subarray(2)
      };
      switch (header.nal_unit_type) {
        case 32:
          videoParameterSet = raw;
          break;
        case 33:
          sequenceParameterSet = raw;
          break;
        case 34:
          pictureParameterSet = raw;
          break;
        default:
          continue;
      }
      count += 1;
      if (count === 3) {
        return {
          videoParameterSet,
          sequenceParameterSet,
          pictureParameterSet
        };
      }
    }
    throw new Error("Invalid data");
  }
  function h265ParseSpsMultilayerExtension(reader) {
    const inter_view_mv_vert_constraint_flag = !!reader.next();
    return {
      inter_view_mv_vert_constraint_flag
    };
  }
  function h265ParseSps3dExtension(reader) {
    const iv_di_mc_enabled_flag = [];
    const iv_mv_scal_enabled_flag = [];
    iv_di_mc_enabled_flag[0] = !!reader.next();
    iv_mv_scal_enabled_flag[0] = !!reader.next();
    const log2_ivmc_sub_pb_size_minus3 = reader.decodeExponentialGolombNumber();
    const iv_res_pred_enabled_flag = !!reader.next();
    const depth_ref_enabled_flag = !!reader.next();
    const vsp_mc_enabled_flag = !!reader.next();
    const dbbp_enabled_flag = !!reader.next();
    iv_di_mc_enabled_flag[1] = !!reader.next();
    iv_mv_scal_enabled_flag[1] = !!reader.next();
    const tex_mc_enabled_flag = !!reader.next();
    const log2_texmc_sub_pb_size_minus3 = reader.decodeExponentialGolombNumber();
    const intra_contour_enabled_flag = !!reader.next();
    const intra_dc_only_wedge_enabled_flag = !!reader.next();
    const cqt_cu_part_pred_enabled_flag = !!reader.next();
    const inter_dc_only_enabled_flag = !!reader.next();
    const skip_intra_enabled_flag = !!reader.next();
    return {
      iv_di_mc_enabled_flag,
      iv_mv_scal_enabled_flag,
      log2_ivmc_sub_pb_size_minus3,
      iv_res_pred_enabled_flag,
      depth_ref_enabled_flag,
      vsp_mc_enabled_flag,
      dbbp_enabled_flag,
      tex_mc_enabled_flag,
      log2_texmc_sub_pb_size_minus3,
      intra_contour_enabled_flag,
      intra_dc_only_wedge_enabled_flag,
      cqt_cu_part_pred_enabled_flag,
      inter_dc_only_enabled_flag,
      skip_intra_enabled_flag
    };
  }
  function h265ParseConfiguration(data) {
    const { videoParameterSet, sequenceParameterSet, pictureParameterSet } = h265SearchConfiguration(data);
    const { profileTierLevel: { generalProfileTier: { profile_space: generalProfileSpace, tier_flag: generalTierFlag, profile_idc: generalProfileIndex, profileCompatibilitySet: generalProfileCompatibilitySet, constraintSet: generalConstraintSet }, general_level_idc: generalLevelIndex } } = h265ParseVideoParameterSet(videoParameterSet.rbsp);
    const { chroma_format_idc, pic_width_in_luma_samples: encodedWidth, pic_height_in_luma_samples: encodedHeight, conf_win_left_offset: cropLeft = 0, conf_win_right_offset: cropRight = 0, conf_win_top_offset: cropTop = 0, conf_win_bottom_offset: cropBottom = 0 } = h265ParseSequenceParameterSet(sequenceParameterSet.rbsp);
    const SubWidthC = getSubWidthC(chroma_format_idc);
    const SubHeightC = getSubHeightC(chroma_format_idc);
    const croppedWidth = encodedWidth - SubWidthC * (cropLeft + cropRight);
    const croppedHeight = encodedHeight - SubHeightC * (cropTop + cropBottom);
    return {
      videoParameterSet,
      sequenceParameterSet,
      pictureParameterSet,
      generalProfileSpace,
      generalProfileIndex,
      generalProfileCompatibilitySet,
      generalTierFlag,
      generalLevelIndex,
      generalConstraintSet,
      encodedWidth,
      encodedHeight,
      cropLeft,
      cropRight,
      cropTop,
      cropBottom,
      croppedWidth,
      croppedHeight
    };
  }

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/codec/utils.js
  function hexDigits(value) {
    return value.toString(16).toUpperCase();
  }
  function hexTwoDigits(value) {
    return value.toString(16).toUpperCase().padStart(2, "0");
  }
  function decimalTwoDigits(value) {
    return value.toString(10).padStart(2, "0");
  }

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/codec/av1.js
  var Av1Codec = class {
    #decoder;
    #updateSize;
    #options;
    #config;
    #configured = false;
    constructor(decoder, updateSize, options) {
      this.#decoder = decoder;
      this.#updateSize = updateSize;
      this.#options = options;
    }
    #parseConfig(data) {
      const parser = new Av1(data);
      const sequenceHeader = parser.searchSequenceHeaderObu();
      if (!sequenceHeader) {
        return;
      }
      const { seq_profile: seqProfile, seq_level_idx: [seqLevelIdx = 0], max_frame_width_minus_1, max_frame_height_minus_1, color_config: { BitDepth, mono_chrome: monoChrome, subsampling_x: subsamplingX, subsampling_y: subsamplingY, chroma_sample_position: chromaSamplePosition, color_description_present_flag } } = sequenceHeader;
      let colorPrimaries;
      let transferCharacteristics;
      let matrixCoefficients;
      let colorRange;
      if (color_description_present_flag) {
        ({
          color_primaries: colorPrimaries,
          transfer_characteristics: transferCharacteristics,
          matrix_coefficients: matrixCoefficients,
          color_range: colorRange
        } = sequenceHeader.color_config);
      } else {
        colorPrimaries = Av1.ColorPrimaries.Bt709;
        transferCharacteristics = Av1.TransferCharacteristics.Bt709;
        matrixCoefficients = Av1.MatrixCoefficients.Bt709;
        colorRange = false;
      }
      const width = max_frame_width_minus_1 + 1;
      const height = max_frame_height_minus_1 + 1;
      this.#updateSize(width, height);
      const codec = [
        "av01",
        seqProfile.toString(16),
        decimalTwoDigits(seqLevelIdx) + (sequenceHeader.seq_tier[0] ? "H" : "M"),
        decimalTwoDigits(BitDepth),
        monoChrome ? "1" : "0",
        (subsamplingX ? "1" : "0") + (subsamplingY ? "1" : "0") + chromaSamplePosition.toString(),
        decimalTwoDigits(colorPrimaries),
        decimalTwoDigits(transferCharacteristics),
        decimalTwoDigits(matrixCoefficients),
        colorRange ? "1" : "0"
      ].join(".");
      this.#config = {
        codec,
        hardwareAcceleration: this.#options?.hardwareAcceleration ?? "no-preference",
        optimizeForLatency: true
      };
      this.#configured = false;
    }
    decode(packet) {
      if (packet.type === "configuration") {
        return;
      }
      this.#parseConfig(packet.data);
      if (!this.#config) {
        throw new Error("Decoder not configured");
      }
      if (packet.keyframe) {
        if (this.#decoder.decodeQueueSize) {
          this.#decoder.reset();
          this.#decoder.configure(this.#config);
          this.#configured = true;
        } else if (!this.#configured) {
          this.#decoder.configure(this.#config);
          this.#configured = true;
        }
      }
      this.#decoder.decode(new EncodedVideoChunk({
        // AV1 requires Scrcpy 2.0 where `keyframe` flag must be set
        type: packet.keyframe ? "key" : "delta",
        timestamp: 0,
        data: packet.data
      }));
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/codec/h26x.js
  var H26xDecoder = class {
    #decoder;
    #config;
    #configured = false;
    constructor(decoder) {
      this.#decoder = decoder;
    }
    #configureAndDecodeFirstKeyframe(config, packet) {
      this.#decoder.configure(config);
      this.#configured = true;
      const { raw } = config;
      const data = new Uint8Array(raw.length + packet.data.length);
      data.set(raw, 0);
      data.set(packet.data, raw.length);
      this.#decoder.decode(new EncodedVideoChunk({
        type: "key",
        timestamp: 0,
        data
      }));
    }
    decode(packet) {
      if (packet.type === "configuration") {
        this.#config = {
          ...this.configure(packet.data),
          raw: packet.data
        };
        this.#configured = false;
        return;
      }
      if (!this.#config) {
        throw new Error("Decoder not configured");
      }
      if (packet.keyframe) {
        if (this.#decoder.decodeQueueSize) {
          this.#decoder.reset();
          this.#configureAndDecodeFirstKeyframe(this.#config, packet);
          return;
        }
        if (!this.#configured) {
          this.#configureAndDecodeFirstKeyframe(this.#config, packet);
          return;
        }
      }
      if (!this.#configured) {
        if (packet.keyframe === void 0) {
          this.#configureAndDecodeFirstKeyframe(this.#config, packet);
          return;
        }
        throw new Error("Expect a keyframe but got a delta frame");
      }
      this.#decoder.decode(new EncodedVideoChunk({
        // Treat `undefined` as `key`, otherwise won't decode.
        type: packet.keyframe === false ? "delta" : "key",
        timestamp: 0,
        data: packet.data
      }));
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/codec/h264.js
  var H264Decoder = class extends H26xDecoder {
    #updateSize;
    #options;
    constructor(decoder, updateSize, options) {
      super(decoder);
      this.#updateSize = updateSize;
      this.#options = options;
    }
    configure(data) {
      const { profileIndex, constraintSet, levelIndex, croppedWidth, croppedHeight } = h264ParseConfiguration(data);
      this.#updateSize(croppedWidth, croppedHeight);
      const codec = "avc1." + hexTwoDigits(profileIndex) + hexTwoDigits(constraintSet) + hexTwoDigits(levelIndex);
      return {
        codec,
        hardwareAcceleration: this.#options?.hardwareAcceleration ?? "no-preference",
        optimizeForLatency: true
      };
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/codec/h265.js
  var H265Decoder = class extends H26xDecoder {
    #updateSize;
    #options;
    constructor(decoder, updateSize, options) {
      super(decoder);
      this.#updateSize = updateSize;
      this.#options = options;
    }
    configure(data) {
      const { generalProfileSpace, generalProfileIndex, generalProfileCompatibilitySet, generalTierFlag, generalLevelIndex, generalConstraintSet, croppedWidth, croppedHeight } = h265ParseConfiguration(data);
      this.#updateSize(croppedWidth, croppedHeight);
      const codec = [
        "hev1",
        ["", "A", "B", "C"][generalProfileSpace] + generalProfileIndex.toString(),
        hexDigits(getUint32LittleEndian(generalProfileCompatibilitySet, 0)),
        (generalTierFlag ? "H" : "L") + generalLevelIndex.toString(),
        ...Array.from(generalConstraintSet, hexDigits)
      ].join(".");
      return {
        codec,
        // Microsoft Edge requires explicit size to work
        codedWidth: croppedWidth,
        codedHeight: croppedHeight,
        hardwareAcceleration: this.#options?.hardwareAcceleration ?? "no-preference",
        optimizeForLatency: true
      };
    }
  };

  // node_modules/@yume-chan/event/esm/disposable.js
  var AutoDisposable = class {
    #disposables = [];
    constructor() {
      this.dispose = this.dispose.bind(this);
    }
    addDisposable(disposable) {
      this.#disposables.push(disposable);
      return disposable;
    }
    dispose() {
      for (const disposable of this.#disposables) {
        disposable.dispose();
      }
      this.#disposables = [];
    }
  };

  // node_modules/@yume-chan/event/esm/event-emitter.js
  var EventEmitter = class {
    listeners = [];
    constructor() {
      this.event = this.event.bind(this);
    }
    addEventListener(info) {
      this.listeners.push(info);
      const remove = () => {
        const index = this.listeners.indexOf(info);
        if (index !== -1) {
          this.listeners.splice(index, 1);
        }
      };
      remove.dispose = remove;
      return remove;
    }
    event = (listener, thisArg, ...args) => {
      const info = {
        listener,
        thisArg,
        args
      };
      return this.addEventListener(info);
    };
    fire(e) {
      for (const info of this.listeners.slice()) {
        info.listener.call(info.thisArg, e, ...info.args);
      }
    }
    dispose() {
      this.listeners.length = 0;
    }
  };

  // node_modules/@yume-chan/event/esm/sticky-event-emitter.js
  var Undefined = /* @__PURE__ */ Symbol("undefined");
  var StickyEventEmitter = class extends EventEmitter {
    #value = Undefined;
    addEventListener(info) {
      if (this.#value !== Undefined) {
        info.listener.call(info.thisArg, this.#value, ...info.args);
      }
      return super.addEventListener(info);
    }
    fire(e) {
      this.#value = e;
      super.fire(e);
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/pool.js
  var Pool = class {
    #controller;
    #readable = new ReadableStream({
      start: (controller) => {
        this.#controller = controller;
      },
      pull: (controller) => {
        controller.enqueue(this.#initializer());
      }
    }, { highWaterMark: 0 });
    #reader = this.#readable.getReader();
    #initializer;
    #size = 0;
    #capacity;
    constructor(initializer, capacity) {
      this.#initializer = initializer;
      this.#capacity = capacity;
    }
    async borrow() {
      const result = await this.#reader.read();
      return result.value;
    }
    return(value) {
      if (this.#size < this.#capacity) {
        this.#controller.enqueue(value);
        this.#size += 1;
      }
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/snapshot.js
  var VideoFrameCapturer = class {
    #canvas;
    #context;
    constructor() {
      if (typeof OffscreenCanvas !== "undefined") {
        this.#canvas = new OffscreenCanvas(1, 1);
      } else {
        this.#canvas = document.createElement("canvas");
        this.#canvas.width = 1;
        this.#canvas.height = 1;
      }
      this.#context = this.#canvas.getContext("bitmaprenderer", {
        alpha: false
      });
    }
    async capture(frame) {
      this.#canvas.width = frame.displayWidth;
      this.#canvas.height = frame.displayHeight;
      const bitmap = await createImageBitmap(frame);
      this.#context.transferFromImageBitmap(bitmap);
      if (this.#canvas instanceof OffscreenCanvas) {
        return await this.#canvas.convertToBlob({
          type: "image/png"
        });
      } else {
        return new Promise((resolve, reject) => {
          this.#canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error("Failed to convert canvas to blob"));
            } else {
              resolve(blob);
            }
          }, "image/png");
        });
      }
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/decoder.js
  var VideoFrameCapturerPool = /* @__PURE__ */ new Pool(() => new VideoFrameCapturer(), 4);
  var WebCodecsVideoDecoder = class {
    static get isSupported() {
      return typeof globalThis.VideoDecoder !== "undefined";
    }
    static capabilities = {
      h264: {},
      h265: {},
      av1: {}
    };
    #codec;
    get codec() {
      return this.#codec;
    }
    #renderer;
    get renderer() {
      return this.#renderer;
    }
    #options;
    #codecDecoder;
    #writable;
    get writable() {
      return this.#writable;
    }
    #error;
    #controller;
    #framesDraw = 0;
    #framesPresented = 0;
    get framesRendered() {
      return this.#framesPresented;
    }
    #framesSkipped = 0;
    get framesSkipped() {
      return this.#framesSkipped;
    }
    #sizeChanged = new StickyEventEmitter();
    get sizeChanged() {
      return this.#sizeChanged.event;
    }
    #width = 0;
    get width() {
      return this.#width;
    }
    #height = 0;
    get height() {
      return this.#height;
    }
    #decoder;
    #drawing = false;
    #nextFrame;
    #captureFrame;
    #animationFrameId = 0;
    /**
     * Create a new WebCodecs video decoder.
     */
    constructor({ codec, renderer, ...options }) {
      this.#codec = codec;
      this.#renderer = renderer;
      this.#options = options;
      this.#decoder = new VideoDecoder({
        output: (frame) => {
          this.#captureFrame?.close();
          this.#captureFrame = frame.clone();
          if (this.#drawing) {
            if (this.#nextFrame) {
              this.#nextFrame.close();
              this.#framesSkipped += 1;
            }
            this.#nextFrame = frame;
            return;
          }
          void this.#draw(frame);
        },
        error: (error) => {
          this.#setError(error);
        }
      });
      switch (this.#codec) {
        case ScrcpyVideoCodecId.H264:
          this.#codecDecoder = new H264Decoder(this.#decoder, this.#updateSize, this.#options);
          break;
        case ScrcpyVideoCodecId.H265:
          this.#codecDecoder = new H265Decoder(this.#decoder, this.#updateSize, this.#options);
          break;
        case ScrcpyVideoCodecId.AV1:
          this.#codecDecoder = new Av1Codec(this.#decoder, this.#updateSize, this.#options);
          break;
        default:
          throw new Error(`Unsupported codec: ${this.#codec}`);
      }
      this.#writable = new WritableStream({
        start: (controller) => {
          if (this.#error) {
            controller.error(this.#error);
          } else {
            this.#controller = controller;
          }
        },
        write: (packet) => {
          this.#codecDecoder.decode(packet);
        }
      });
      this.#handleAnimationFrame();
    }
    #setError(error) {
      if (this.#controller) {
        try {
          this.#controller.error(error);
        } catch {
        }
      } else {
        this.#error = error;
      }
    }
    async #draw(frame) {
      try {
        this.#drawing = true;
        this.#updateSize(frame.displayWidth, frame.displayHeight);
        await this.#renderer.draw(frame);
        this.#framesDraw += 1;
        frame.close();
        if (this.#nextFrame) {
          const frame2 = this.#nextFrame;
          this.#nextFrame = void 0;
          await this.#draw(frame2);
        }
        this.#drawing = false;
      } catch (error) {
        this.#setError(error);
      }
    }
    #updateSize = (width, height) => {
      this.#renderer.setSize(width, height);
      this.#width = width;
      this.#height = height;
      this.#sizeChanged.fire({ width, height });
    };
    #handleAnimationFrame = () => {
      if (this.#framesDraw > 0) {
        this.#framesPresented += 1;
        this.#framesSkipped += this.#framesDraw - 1;
        this.#framesDraw = 0;
      }
      this.#animationFrameId = requestAnimationFrame(this.#handleAnimationFrame);
    };
    async snapshot() {
      const frame = this.#captureFrame;
      if (!frame) {
        return void 0;
      }
      const capturer = await VideoFrameCapturerPool.borrow();
      const result = await capturer.capture(frame);
      VideoFrameCapturerPool.return(capturer);
      return result;
    }
    dispose() {
      cancelAnimationFrame(this.#animationFrameId);
      if (this.#decoder.state !== "closed") {
        this.#decoder.close();
      }
      this.#nextFrame?.close();
      this.#captureFrame?.close();
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-tinyh264/esm/decoder.js
  var import_yuv_buffer = __toESM(require_yuv_buffer(), 1);
  var import_yuv_canvas = __toESM(require_yuv_canvas(), 1);

  // node_modules/@yume-chan/scrcpy-decoder-tinyh264/esm/wrapper.js
  var import_meta = {};
  var worker;
  var workerReady = false;
  var pendingResolvers = [];
  var streamId = 0;
  var PICTURE_READY_SUBSCRIPTIONS = /* @__PURE__ */ new Map();
  function subscribePictureReady(streamId2, handler) {
    PICTURE_READY_SUBSCRIPTIONS.set(streamId2, handler);
    return {
      dispose() {
        PICTURE_READY_SUBSCRIPTIONS.delete(streamId2);
      }
    };
  }
  var TinyH264Wrapper = class extends AutoDisposable {
    streamId;
    #pictureReadyEvent = new EventEmitter();
    get onPictureReady() {
      return this.#pictureReadyEvent.event;
    }
    constructor(streamId2) {
      super();
      this.streamId = streamId2;
      this.addDisposable(subscribePictureReady(streamId2, this.#handlePictureReady));
    }
    #handlePictureReady = (e) => {
      this.#pictureReadyEvent.fire(e);
    };
    feed(data) {
      worker.postMessage({
        type: "decode",
        data,
        offset: 0,
        length: data.byteLength,
        renderStateId: this.streamId
      }, [data]);
    }
    dispose() {
      super.dispose();
      worker.postMessage({
        type: "release",
        renderStateId: this.streamId
      });
    }
  };
  function createTinyH264Wrapper() {
    if (!worker) {
      worker = new Worker(new URL("./worker.js", import_meta.url), {
        type: "module"
      });
      worker.addEventListener("message", ({ data }) => {
        switch (data.type) {
          case "decoderReady":
            workerReady = true;
            for (const resolver of pendingResolvers) {
              resolver.resolve(new TinyH264Wrapper(streamId));
              streamId += 1;
            }
            pendingResolvers.length = 0;
            break;
          case "pictureReady":
            PICTURE_READY_SUBSCRIPTIONS.get(data.renderStateId)?.(data);
            break;
        }
      });
    }
    if (!workerReady) {
      const resolver = new PromiseResolver();
      pendingResolvers.push(resolver);
      return resolver.promise;
    }
    const decoder = new TinyH264Wrapper(streamId);
    streamId += 1;
    return Promise.resolve(decoder);
  }

  // node_modules/@yume-chan/scrcpy-decoder-tinyh264/esm/decoder.js
  var noop = () => {
  };
  function createCanvas() {
    if (typeof document !== "undefined") {
      return document.createElement("canvas");
    }
    if (typeof OffscreenCanvas !== "undefined") {
      return new OffscreenCanvas(1, 1);
    }
    throw new Error("no canvas input found nor any canvas can be created");
  }
  var TinyH264Decoder = class {
    static capabilities = {
      h264: {
        maxProfile: AndroidAvcProfile.Baseline,
        maxLevel: AndroidAvcLevel.Level4
      }
    };
    #renderer;
    get renderer() {
      return this.#renderer;
    }
    #sizeChanged = new StickyEventEmitter();
    get sizeChanged() {
      return this.#sizeChanged.event;
    }
    #width = 0;
    get width() {
      return this.#width;
    }
    #height = 0;
    get height() {
      return this.#height;
    }
    #frameRendered = 0;
    get framesRendered() {
      return this.#frameRendered;
    }
    #frameSkipped = 0;
    get framesSkipped() {
      return this.#frameSkipped;
    }
    #writable;
    get writable() {
      return this.#writable;
    }
    #yuvCanvas;
    #initializer;
    constructor({ canvas } = {}) {
      if (canvas) {
        this.#renderer = canvas;
      } else {
        this.#renderer = createCanvas();
      }
      this.#writable = new WritableStream({
        write: async (packet) => {
          switch (packet.type) {
            case "configuration":
              await this.#configure(packet.data);
              break;
            case "data": {
              if (!this.#initializer) {
                throw new Error("Decoder not configured");
              }
              const wrapper = await this.#initializer.promise;
              wrapper.feed(packet.data.slice().buffer);
              break;
            }
          }
        }
      });
    }
    async #configure(data) {
      this.dispose();
      this.#initializer = new PromiseResolver();
      if (!this.#yuvCanvas) {
        const canvas = createCanvas();
        const attributes = {
          // Disallow software rendering.
          // Other rendering methods are faster than software-based WebGL.
          failIfMajorPerformanceCaveat: true
        };
        const gl = canvas.getContext("webgl2", attributes) || canvas.getContext("webgl", attributes);
        this.#yuvCanvas = import_yuv_canvas.default.attach(this.#renderer, {
          webGL: !!gl
        });
      }
      const { encodedWidth, encodedHeight, croppedWidth, croppedHeight, cropLeft, cropTop } = h264ParseConfiguration(data);
      this.#width = croppedWidth;
      this.#height = croppedHeight;
      this.#sizeChanged.fire({
        width: croppedWidth,
        height: croppedHeight
      });
      const chromaWidth = encodedWidth / 2;
      const chromaHeight = encodedHeight / 2;
      const format = import_yuv_buffer.default.format({
        width: encodedWidth,
        height: encodedHeight,
        chromaWidth,
        chromaHeight,
        cropLeft,
        cropTop,
        cropWidth: croppedWidth,
        cropHeight: croppedHeight,
        displayWidth: croppedWidth,
        displayHeight: croppedHeight
      });
      const wrapper = await createTinyH264Wrapper();
      this.#initializer.resolve(wrapper);
      const uPlaneOffset = encodedWidth * encodedHeight;
      const vPlaneOffset = uPlaneOffset + chromaWidth * chromaHeight;
      wrapper.onPictureReady(({ data: data2 }) => {
        this.#frameRendered += 1;
        const array = new Uint8Array(data2);
        const frame = import_yuv_buffer.default.frame(format, import_yuv_buffer.default.lumaPlane(format, array, encodedWidth, 0), import_yuv_buffer.default.chromaPlane(format, array, chromaWidth, uPlaneOffset), import_yuv_buffer.default.chromaPlane(format, array, chromaWidth, vPlaneOffset));
        this.#yuvCanvas.drawFrame(frame);
      });
      wrapper.feed(data.slice().buffer);
    }
    dispose() {
      this.#initializer?.promise.then((wrapper) => wrapper.dispose()).catch(noop);
      this.#initializer = void 0;
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/canvas.js
  var CanvasVideoFrameRenderer = class {
    #canvas;
    get canvas() {
      return this.#canvas;
    }
    constructor(canvas) {
      if (canvas) {
        this.#canvas = canvas;
      } else {
        this.#canvas = createCanvas();
      }
    }
    setSize(width, height) {
      if (this.#canvas.width !== width || this.#canvas.height !== height) {
        this.#canvas.width = width;
        this.#canvas.height = height;
      }
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/bitmap.js
  var BitmapVideoFrameRenderer = class extends CanvasVideoFrameRenderer {
    #context;
    constructor(canvas) {
      super(canvas);
      this.#context = this.canvas.getContext("bitmaprenderer", {
        alpha: false
      });
    }
    async draw(frame) {
      const bitmap = await createImageBitmap(frame);
      this.#context.transferFromImageBitmap(bitmap);
    }
  };

  // node_modules/@yume-chan/scrcpy-decoder-webcodecs/esm/video/render/webgl.js
  var Resolved = Promise.resolve();
  function createContext(canvas, enableCapture) {
    const attributes = {
      // Low-power GPU should be enough for video rendering.
      powerPreference: "low-power",
      alpha: false,
      // Disallow software rendering.
      // Other rendering methods are faster than software-based WebGL.
      failIfMajorPerformanceCaveat: true,
      preserveDrawingBuffer: !!enableCapture
    };
    return canvas.getContext("webgl2", attributes) || canvas.getContext("webgl", attributes);
  }
  var WebGLVideoFrameRenderer = class _WebGLVideoFrameRenderer extends CanvasVideoFrameRenderer {
    static vertexShaderSource = `
        attribute vec2 xy;

        varying highp vec2 uv;

        void main(void) {
            gl_Position = vec4(xy, 0.0, 1.0);
            // Map vertex coordinates (-1 to +1) to UV coordinates (0 to 1).
            // UV coordinates are Y-flipped relative to vertex coordinates.
            uv = vec2((1.0 + xy.x) / 2.0, (1.0 - xy.y) / 2.0);
        }
`;
    static fragmentShaderSource = `
        varying highp vec2 uv;

        uniform sampler2D texture;

        void main(void) {
            gl_FragColor = texture2D(texture, uv);
        }
`;
    static get isSupported() {
      const canvas = createCanvas();
      return !!createContext(canvas);
    }
    #context;
    /**
     * Create a new WebGL frame renderer.
     * @param canvas The canvas to render frames to.
     * @param enableCapture
     * Whether to allow capturing the canvas content using APIs like `readPixels` and `toDataURL`.
     * Enable this option may reduce performance.
     */
    constructor(canvas, enableCapture) {
      super(canvas);
      const gl = createContext(this.canvas, enableCapture);
      if (!gl) {
        throw new Error("WebGL not supported");
      }
      this.#context = gl;
      const vertexShader = gl.createShader(gl.VERTEX_SHADER);
      gl.shaderSource(vertexShader, _WebGLVideoFrameRenderer.vertexShaderSource);
      gl.compileShader(vertexShader);
      if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(vertexShader));
      }
      const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
      gl.shaderSource(fragmentShader, _WebGLVideoFrameRenderer.fragmentShaderSource);
      gl.compileShader(fragmentShader);
      if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(fragmentShader));
      }
      const shaderProgram = gl.createProgram();
      gl.attachShader(shaderProgram, vertexShader);
      gl.attachShader(shaderProgram, fragmentShader);
      gl.linkProgram(shaderProgram);
      if (!gl.getProgramParameter(shaderProgram, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(shaderProgram));
      }
      gl.useProgram(shaderProgram);
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
      const xyLocation = gl.getAttribLocation(shaderProgram, "xy");
      gl.vertexAttribPointer(xyLocation, 2, gl.FLOAT, false, 0, 0);
      gl.enableVertexAttribArray(xyLocation);
      const texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    draw(frame) {
      const gl = this.#context;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      return Resolved;
    }
  };

  // client-src/mirror-panel.js
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "style") node.style.cssText = v;
      else node.setAttribute(k, v);
    }
    for (const c of [].concat(children)) if (c) node.appendChild(c);
    return node;
  }
  var clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
  var clamp11 = (v) => v < -1 ? -1 : v > 1 ? 1 : v;
  var KEYCODE_MAP = {
    Enter: 66,
    Backspace: 67,
    Delete: 112,
    Tab: 61,
    Escape: 111,
    ArrowLeft: 21,
    ArrowRight: 22,
    ArrowUp: 19,
    ArrowDown: 20,
    " ": 62
    // Space
  };
  var START_OPTS = { maxSize: 1024, bitRate: 4e6, maxFps: 30 };
  var RECONNECT_DELAY_MS = 3e3;
  var MirrorPanel = class {
    constructor() {
      this.ws = null;
      this.decoder = null;
      this.writer = null;
      this.rendererEl = null;
      this.serial = null;
      this.userDisconnected = false;
      this.reconnectTimer = null;
      this.pendingMove = null;
      this.moveRaf = 0;
      this.visible = false;
      this._buildDom();
    }
    // ---------- สร้าง DOM ทั้งพาเนล ----------
    _buildDom() {
      this.deviceSelect = el("select", { class: "mirror-select", title: "\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C" });
      this.refreshBtn = el("button", { class: "mirror-icon-btn", title: "\u0E23\u0E35\u0E40\u0E1F\u0E23\u0E0A\u0E23\u0E32\u0E22\u0E0A\u0E37\u0E48\u0E2D\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C", text: "\u27F2" });
      this.connectBtn = el("button", { class: "mirror-btn primary", text: "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D" });
      this.hideBtn = el("button", { class: "mirror-icon-btn", title: "\u0E0B\u0E48\u0E2D\u0E19\u0E1E\u0E32\u0E40\u0E19\u0E25 (\u0E22\u0E31\u0E07\u0E15\u0E48\u0E2D\u0E2D\u0E22\u0E39\u0E48)", text: "\u2014" });
      this.statusDot = el("span", { class: "mirror-dot" });
      this.statusText = el("span", { class: "mirror-status-text", text: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D" });
      this.refreshBtn.addEventListener("click", () => this.refreshDevices());
      this.connectBtn.addEventListener("click", () => this._onConnectBtn());
      this.hideBtn.addEventListener("click", () => this.hide());
      const header = el("div", { class: "mirror-header" }, [
        el("div", { class: "mirror-header-row" }, [
          el("span", { class: "mirror-title", text: "\u{1F4F1} Mirror" }),
          this.hideBtn
        ]),
        el("div", { class: "mirror-header-row" }, [this.deviceSelect, this.refreshBtn]),
        el("div", { class: "mirror-header-row" }, [
          this.connectBtn,
          el("span", { class: "mirror-statusline" }, [this.statusDot, this.statusText])
        ])
      ]);
      this.videoArea = el("div", { class: "mirror-video", tabindex: "0" });
      this.videoPlaceholder = el("div", { class: "mirror-placeholder", text: "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E21\u0E35\u0E20\u0E32\u0E1E \u2014 \u0E01\u0E14\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D" });
      this.videoArea.appendChild(this.videoPlaceholder);
      this._bindInput(this.videoArea);
      const mkTool = (label, title, fn) => {
        const b = el("button", { class: "mirror-tool", title, text: label });
        b.addEventListener("click", () => fn());
        return b;
      };
      const toolbar = el("div", { class: "mirror-toolbar" }, [
        mkTool("\u2B05", "\u0E22\u0E49\u0E2D\u0E19\u0E01\u0E25\u0E31\u0E1A", () => this.send({ type: "back" })),
        mkTool("\u2B58", "\u0E2B\u0E19\u0E49\u0E32\u0E2B\u0E25\u0E31\u0E01", () => this.send({ type: "home" })),
        mkTool("\u25A2", "\u0E41\u0E2D\u0E1B\u0E25\u0E48\u0E32\u0E2A\u0E38\u0E14", () => this.send({ type: "appswitch" })),
        mkTool("\u{1F504}", "\u0E2B\u0E21\u0E38\u0E19\u0E08\u0E2D", () => this.send({ type: "rotate" })),
        mkTool("\u23FB", "\u0E1B\u0E38\u0E48\u0E21 power", () => this.send({ type: "power" })),
        mkTool("\u27F3", "\u0E02\u0E2D keyframe", () => this.send({ type: "keyframe" }))
      ]);
      this.textInput = el("input", {
        class: "mirror-text-input",
        type: "text",
        placeholder: "\u0E1E\u0E34\u0E21\u0E1E\u0E4C\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21\u0E2A\u0E48\u0E07\u0E40\u0E02\u0E49\u0E32\u0E40\u0E04\u0E23\u0E37\u0E48\u0E2D\u0E07\u2026"
      });
      this.textInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          this._sendText();
        }
      });
      const sendBtn = el("button", { class: "mirror-btn", text: "\u0E2A\u0E48\u0E07\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21" });
      sendBtn.addEventListener("click", () => this._sendText());
      const bottomRow = el("div", { class: "mirror-bottom" }, [this.textInput, sendBtn]);
      this.drawer = el("div", { class: "mirror-drawer", id: "mirrorDrawer" }, [
        header,
        this.videoArea,
        toolbar,
        bottomRow
      ]);
      this.drawer.style.display = "none";
      document.body.appendChild(this.drawer);
    }
    // ---------- โหลดรายชื่ออุปกรณ์ ----------
    async refreshDevices() {
      try {
        const r = await fetch("/api/devices");
        const j = await r.json();
        const devices = j && j.devices || [];
        const prev = this.deviceSelect.value;
        this.deviceSelect.innerHTML = "";
        if (!devices.length) {
          this.deviceSelect.appendChild(el("option", { value: "", text: "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C" }));
          return;
        }
        for (const d of devices) {
          const label = `${d.model || d.serial}${d.emulator ? " (emu)" : ""} \u2014 ${d.serial}`;
          this.deviceSelect.appendChild(el("option", { value: d.serial, text: label }));
        }
        if (prev && devices.some((d) => d.serial === prev)) this.deviceSelect.value = prev;
      } catch (e) {
        this.deviceSelect.innerHTML = "";
        this.deviceSelect.appendChild(el("option", { value: "", text: "\u0E42\u0E2B\u0E25\u0E14\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49" }));
      }
    }
    // ---------- สถานะ ----------
    _setStatus(state, text) {
      this.statusDot.dataset.state = state;
      this.statusText.textContent = text;
    }
    _setConnected(isConn) {
      this.connectBtn.textContent = isConn ? "\u0E15\u0E31\u0E14\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D" : "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D";
      this.connectBtn.classList.toggle("danger", isConn);
      this.connectBtn.classList.toggle("primary", !isConn);
    }
    _onConnectBtn() {
      if (this.ws) this.disconnect();
      else this.connect(this.deviceSelect.value);
    }
    // ---------- WebSocket lifecycle ----------
    connect(serial) {
      if (!serial) {
        this._setStatus("error", "\u0E22\u0E31\u0E07\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49\u0E40\u0E25\u0E37\u0E2D\u0E01\u0E2D\u0E38\u0E1B\u0E01\u0E23\u0E13\u0E4C");
        return;
      }
      if (typeof VideoDecoder === "undefined") {
        this._setStatus("error", "\u0E40\u0E1A\u0E23\u0E32\u0E27\u0E4C\u0E40\u0E0B\u0E2D\u0E23\u0E4C\u0E19\u0E35\u0E49\u0E44\u0E21\u0E48\u0E23\u0E2D\u0E07\u0E23\u0E31\u0E1A WebCodecs \u2014 \u0E43\u0E0A\u0E49 Chrome/Edge");
        return;
      }
      if (this.ws) this.disconnect();
      this.serial = serial;
      this.userDisconnected = false;
      this._clearReconnect();
      this._openWs();
    }
    _openWs() {
      this._setStatus("connecting", "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u2026");
      this._setConnected(true);
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      let ws;
      try {
        ws = new WebSocket(`${proto}//${location.host}/api/mirror`);
      } catch (e) {
        this._scheduleReconnect();
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;
      ws.addEventListener("open", () => {
        this.send({ type: "start", serial: this.serial, ...START_OPTS });
      });
      ws.addEventListener("message", (ev) => this._onMessage(ev));
      ws.addEventListener("error", () => {
      });
      ws.addEventListener("close", () => this._onClose(ws));
    }
    _onClose(ws) {
      if (ws !== this.ws) return;
      this.ws = null;
      this._teardownDecoder();
      if (this.userDisconnected) {
        this._setStatus("idle", "\u0E15\u0E31\u0E14\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E41\u0E25\u0E49\u0E27");
        this._setConnected(false);
        return;
      }
      this._scheduleReconnect();
    }
    _scheduleReconnect() {
      if (this.userDisconnected) return;
      this._setStatus("connecting", "\u0E01\u0E33\u0E25\u0E31\u0E07\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E43\u0E2B\u0E21\u0E48\u2026");
      this._setConnected(true);
      this._clearReconnect();
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        if (!this.userDisconnected) this._openWs();
      }, RECONNECT_DELAY_MS);
    }
    _clearReconnect() {
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    }
    // disconnect โดยผู้ใช้ — ส่ง stop, ปิด, ไม่ retry
    disconnect() {
      this.userDisconnected = true;
      this._clearReconnect();
      if (this.ws) {
        try {
          this.send({ type: "stop" });
        } catch (e) {
        }
        try {
          this.ws.close();
        } catch (e) {
        }
        this.ws = null;
      }
      this._teardownDecoder();
      this._setStatus("idle", "\u0E15\u0E31\u0E14\u0E01\u0E32\u0E23\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E41\u0E25\u0E49\u0E27");
      this._setConnected(false);
    }
    send(obj) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(obj));
      }
    }
    // ---------- รับ message จาก server ----------
    _onMessage(ev) {
      if (typeof ev.data === "string") {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        this._onControl(msg);
      } else {
        this._onBinary(ev.data);
      }
    }
    _onControl(msg) {
      switch (msg && msg.type) {
        case "ready":
          this._setupDecoder(msg);
          this._setStatus("connected", "\u0E40\u0E0A\u0E37\u0E48\u0E2D\u0E21\u0E15\u0E48\u0E2D\u0E41\u0E25\u0E49\u0E27");
          this._setConnected(true);
          this.videoPlaceholder.style.display = "none";
          break;
        case "meta":
          if (this.rendererEl && msg.width && msg.height) {
            this.rendererEl.style.aspectRatio = `${msg.width} / ${msg.height}`;
          }
          break;
        case "error":
          this._setStatus("error", msg.message || "\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14");
          break;
        case "stopped":
          this._setStatus("idle", "\u0E2A\u0E15\u0E23\u0E35\u0E21\u0E2B\u0E22\u0E38\u0E14" + (msg.reason ? ` \u2014 ${msg.reason}` : ""));
          break;
        default:
          break;
      }
    }
    // ---------- decoder / renderer ----------
    _setupDecoder(ready) {
      this._teardownDecoder();
      let renderer;
      try {
        if (WebGLVideoFrameRenderer && WebGLVideoFrameRenderer.isSupported) {
          renderer = new WebGLVideoFrameRenderer();
        } else {
          renderer = new BitmapVideoFrameRenderer();
        }
      } catch (e) {
        renderer = new BitmapVideoFrameRenderer();
      }
      const codecId = ready && ready.codec === "h265" ? ScrcpyVideoCodecId.H265 : ready && ready.codec === "av1" ? ScrcpyVideoCodecId.AV1 : ScrcpyVideoCodecId.H264;
      let decoder;
      try {
        decoder = new WebCodecsVideoDecoder({ codec: codecId, renderer });
      } catch (e) {
        this._setStatus("error", "\u0E2A\u0E23\u0E49\u0E32\u0E07\u0E15\u0E31\u0E27\u0E16\u0E2D\u0E14\u0E27\u0E34\u0E14\u0E35\u0E42\u0E2D\u0E44\u0E21\u0E48\u0E44\u0E14\u0E49");
        return;
      }
      this.decoder = decoder;
      this.writer = decoder.writable.getWriter();
      const canvas = renderer.canvas;
      canvas.classList.add("mirror-canvas");
      this.rendererEl = canvas;
      if (ready && ready.width && ready.height) {
        canvas.style.aspectRatio = `${ready.width} / ${ready.height}`;
      }
      this.videoArea.appendChild(canvas);
    }
    _teardownDecoder() {
      if (this.writer) {
        try {
          this.writer.releaseLock();
        } catch (e) {
        }
        this.writer = null;
      }
      if (this.decoder) {
        try {
          this.decoder.dispose();
        } catch (e) {
        }
        this.decoder = null;
      }
      if (this.rendererEl && this.rendererEl.parentNode) {
        this.rendererEl.parentNode.removeChild(this.rendererEl);
      }
      this.rendererEl = null;
      if (this.videoPlaceholder) this.videoPlaceholder.style.display = "";
    }
    _onBinary(buf) {
      if (!this.writer) return;
      let packet;
      try {
        const dv = new DataView(buf);
        const kind = dv.getUint8(0);
        const ptsFloat = dv.getFloat64(4, true);
        const payload = new Uint8Array(buf, 12);
        if (kind === 0) {
          packet = { type: "configuration", data: payload };
        } else {
          packet = { type: "data", keyframe: kind === 1, pts: BigInt(Math.round(ptsFloat)), data: payload };
        }
      } catch (e) {
        return;
      }
      this.writer.write(packet).catch(() => {
      });
    }
    // ---------- input capture บนพื้นที่วิดีโอ ----------
    _bindInput(container) {
      const norm = (e) => {
        const target = this.rendererEl || container;
        const r = target.getBoundingClientRect();
        const x = r.width ? (e.clientX - r.left) / r.width : 0;
        const y = r.height ? (e.clientY - r.top) / r.height : 0;
        return { x: clamp01(x), y: clamp01(y) };
      };
      container.addEventListener("pointerdown", (e) => {
        if (!this.ws) return;
        container.focus();
        try {
          container.setPointerCapture(e.pointerId);
        } catch (err) {
        }
        const { x, y } = norm(e);
        this.send({ type: "touch", action: "down", pointerId: e.pointerId, x, y, pressure: e.pressure || 1 });
        e.preventDefault();
      });
      container.addEventListener("pointermove", (e) => {
        if (!this.ws) return;
        if (e.buttons === 0 && e.pointerType === "mouse") return;
        const { x, y } = norm(e);
        this.pendingMove = { pointerId: e.pointerId, x, y, pressure: e.pressure || 1 };
        if (!this.moveRaf) {
          this.moveRaf = requestAnimationFrame(() => {
            this.moveRaf = 0;
            const m = this.pendingMove;
            this.pendingMove = null;
            if (m) this.send({ type: "touch", action: "move", ...m });
          });
        }
      });
      const up = (e) => {
        if (!this.ws) return;
        try {
          container.releasePointerCapture(e.pointerId);
        } catch (err) {
        }
        if (this.moveRaf) {
          cancelAnimationFrame(this.moveRaf);
          this.moveRaf = 0;
        }
        this.pendingMove = null;
        const { x, y } = norm(e);
        this.send({ type: "touch", action: "up", pointerId: e.pointerId, x, y, pressure: 0 });
      };
      container.addEventListener("pointerup", up);
      container.addEventListener("pointercancel", up);
      container.addEventListener("wheel", (e) => {
        if (!this.ws) return;
        e.preventDefault();
        const { x, y } = norm(e);
        this.send({
          type: "scroll",
          x,
          y,
          hDelta: clamp11(-e.deltaX / 100),
          vDelta: clamp11(-e.deltaY / 100)
        });
      }, { passive: false });
      container.addEventListener("keydown", (e) => {
        if (!this.ws) return;
        if (e.key in KEYCODE_MAP) {
          this.send({ type: "key", action: "down", keycode: KEYCODE_MAP[e.key], metaState: 0 });
          e.preventDefault();
          return;
        }
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          this._typeBuffer = (this._typeBuffer || "") + e.key;
          clearTimeout(this._typeTimer);
          this._typeTimer = setTimeout(() => {
            const text = this._typeBuffer;
            this._typeBuffer = "";
            if (text) this.send({ type: "text", text });
          }, 150);
          e.preventDefault();
        }
      });
      container.addEventListener("keyup", (e) => {
        if (!this.ws) return;
        if (e.key in KEYCODE_MAP) {
          this.send({ type: "key", action: "up", keycode: KEYCODE_MAP[e.key], metaState: 0 });
          e.preventDefault();
        }
      });
      container.addEventListener("click", () => container.focus());
    }
    _sendText() {
      const text = this.textInput.value;
      if (!text) return;
      this.send({ type: "text", text });
      this.textInput.value = "";
    }
    // ---------- แสดง/ซ่อนพาเนล ----------
    show() {
      this.drawer.style.display = "flex";
      document.body.classList.add("mirror-open");
      this.visible = true;
      if (!this.deviceSelect.options.length) this.refreshDevices();
    }
    hide() {
      this.drawer.style.display = "none";
      document.body.classList.remove("mirror-open");
      this.visible = false;
    }
    toggle() {
      if (this.visible) this.hide();
      else this.show();
    }
    open(serial) {
      this.show();
      if (serial) {
        const doConnect = () => {
          if (![...this.deviceSelect.options].some((o) => o.value === serial)) {
            this.deviceSelect.appendChild(el("option", { value: serial, text: serial }));
          }
          this.deviceSelect.value = serial;
          this.connect(serial);
        };
        if (!this.deviceSelect.options.length) this.refreshDevices().then(doConnect);
        else doConnect();
      }
    }
    close() {
      this.disconnect();
      this.hide();
    }
  };
  var panel = new MirrorPanel();
  window.MirrorPanel = {
    toggle: () => panel.toggle(),
    open: (serial) => panel.open(serial),
    close: () => panel.close()
  };
})();
/*! Bundled license information:

yuv-canvas/src/depower.js:
  (**
   * Convert a ratio into a bit-shift count; for instance a ratio of 2
   * becomes a bit-shift of 1, while a ratio of 1 is a bit-shift of 0.
   *
   * @author Brooke Vibber <bvibber@pobox.com>
   * @copyright 2016-2024
   * @license MIT-style
   *
   * @param {number} ratio - the integer ratio to convert.
   * @returns {number} - number of bits to shift to multiply/divide by the ratio.
   * @throws exception if given a non-power-of-two
   *)

yuv-canvas/src/YCbCr.js:
  (**
   * Basic YCbCr->RGB conversion
   *
   * @author Brooke Vibber <bvibber@pobox.com>
   * @copyright 2014-2024
   * @license MIT-style
   *
   * @param {YUVFrame} buffer - input frame buffer
   * @param {Uint8ClampedArray} output - array to draw RGBA into
   * Assumes that the output array already has alpha channel set to opaque.
   *)
*/
