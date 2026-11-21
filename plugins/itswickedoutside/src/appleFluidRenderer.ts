/**
 * Apple Music-inspired 2-pass WebGL Fluid & MeshGradient Renderer
 * Renders low-resolution (~320x180) fluid artwork swirls & mesh gradients
 * into an offscreen FBO and applies a 9-tap soft diffusion + IGN dithering pass.
 * Keeps VRAM < 1.5 MB and allocates zero JS objects per animation frame.
 */

export interface FluidRenderParams {
	time: number;
	swirlTime: number;
	bass: number;
	energy: number;
	treble: number;
	saturation: number;
	density: number;
	opacity: number;
	intensity: number;
	apolMode: boolean;
	mode: 'circles' | 'images';
	dt: number;
}

interface Pass1Uniforms {
	resolution: WebGLUniformLocation | null;
	time: WebGLUniformLocation | null;
	swirlTime: WebGLUniformLocation | null;
	bass: WebGLUniformLocation | null;
	energy: WebGLUniformLocation | null;
	treble: WebGLUniformLocation | null;
	intensity: WebGLUniformLocation | null;
	density: WebGLUniformLocation | null;
	apolMode: WebGLUniformLocation | null;
	mode: WebGLUniformLocation | null;
	hasArtwork: WebGLUniformLocation | null;
	transition: WebGLUniformLocation | null;
	texPrev: WebGLUniformLocation | null;
	texCurr: WebGLUniformLocation | null;
	color0: WebGLUniformLocation | null;
	color1: WebGLUniformLocation | null;
	color2: WebGLUniformLocation | null;
	color3: WebGLUniformLocation | null;
	color4: WebGLUniformLocation | null;
	color5: WebGLUniformLocation | null;
}

interface Pass2Uniforms {
	fboTex: WebGLUniformLocation | null;
	texelSize: WebGLUniformLocation | null;
	energy: WebGLUniformLocation | null;
	bass: WebGLUniformLocation | null;
	intensity: WebGLUniformLocation | null;
	saturation: WebGLUniformLocation | null;
	density: WebGLUniformLocation | null;
	opacity: WebGLUniformLocation | null;
}

const ARTWORK_SIZE = 64;
const FBO_SIZE = 256;

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
	v_uv = (a_position + 1.0) * 0.5;
	gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const PASS1_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform vec2 u_resolution;
uniform float u_time;
uniform float u_swirlTime;
uniform float u_bass;
uniform float u_energy;
uniform float u_treble;
uniform float u_intensity;
uniform float u_density;
uniform float u_apolMode;
uniform float u_mode;
uniform float u_hasArtwork;
uniform float u_transition;

uniform sampler2D u_texPrev;
uniform sampler2D u_texCurr;

uniform vec3 u_color0;
uniform vec3 u_color1;
uniform vec3 u_color2;
uniform vec3 u_color3;
uniform vec3 u_color4;
uniform vec3 u_color5;

vec2 rotate2d(vec2 v, float angle) {
	float s = sin(angle);
	float c = cos(angle);
	return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}

vec2 swirlCoord(vec2 p, vec2 center, float radius, float strength) {
	vec2 rel = p - center;
	float dist = length(rel);
	float pct = clamp((radius - dist) / max(radius, 0.001), 0.0, 1.0);
	float theta = pct * pct * strength;
	return center + rotate2d(rel, theta);
}

vec3 sampleCrossfadedArtwork(vec2 p, float scale, vec2 pan) {
	vec2 uv = p / max(scale, 0.1) + 0.5 + pan;
	vec3 prevCol = texture2D(u_texPrev, uv).rgb;
	vec3 currCol = texture2D(u_texCurr, uv).rgb;
	return mix(prevCol, currCol, smoothstep(0.0, 1.0, u_transition));
}

float gaussianLobe(vec2 p, vec2 center, float radius) {
	vec2 d = p - center;
	float invR2 = 1.0 / max(radius * radius, 0.01);
	return exp(-dot(d, d) * invR2);
}

void main() {
	float aspect = u_resolution.x / max(u_resolution.y, 1.0);
	vec2 p = (v_uv - 0.5) * vec2(aspect, 1.0);

	float react = clamp(u_intensity * 0.55, 0.0, 1.5);
	float bassReact = clamp(u_bass * react, 0.0, 1.25);
	float trebleReact = clamp(u_treble * react, 0.0, 1.0);

	// Viscoelastic breathing: inward contraction in apolMode, expansive swell in normal mode
	float breathZoom = u_apolMode > 0.5
		? (1.0 + bassReact * 0.13)
		: (1.0 - bassReact * 0.11);
	p *= breathZoom;

	if (u_mode > 0.5 && u_hasArtwork > 0.5) {
		// Classic Apple Music Metal-style multi-layer twisted artwork swirl
		float t = u_time;
		float st = u_swirlTime;
		float orbit = 0.28 + u_energy * 0.10;

		vec2 c1 = vec2(sin(st * 0.53) * orbit, cos(st * 0.41) * orbit * 0.8);
		vec2 c2 = vec2(cos(st * 0.67 + 1.4) * orbit, sin(st * 0.49 + 0.7) * orbit * 0.8);
		vec2 c3 = vec2(sin(st * 0.37 + 2.6) * orbit * 1.1, cos(st * 0.61 + 2.1) * orbit);
		vec2 c4 = vec2(cos(st * 0.43 + 4.1) * orbit, sin(st * 0.73 + 3.2) * orbit);

		float torque = 2.6 + bassReact * 1.15 + u_energy * 0.55;

		// Layer 1: Primary deep slow-rotating base
		vec2 p1 = rotate2d(p, t * 0.11);
		p1 = swirlCoord(p1, c1, 0.95, torque * sin(st * 0.35 + 0.4));
		vec3 col1 = sampleCrossfadedArtwork(p1, 1.48, vec2(sin(t * 0.07), cos(t * 0.05)) * 0.06);

		// Layer 2: Counter-rotating fluid fold
		vec2 p2 = rotate2d(p, -t * 0.16 + 1.2);
		p2 = swirlCoord(p2, c2, 1.05, -torque * cos(st * 0.31 + 1.1));
		vec3 col2 = sampleCrossfadedArtwork(p2, 1.85, vec2(cos(t * 0.08), sin(t * 0.06)) * 0.08);

		// Layer 3: Wide color field warp
		vec2 p3 = rotate2d(p, t * 0.09 - 2.1);
		p3 = swirlCoord(p3, c3, 1.15, torque * 0.85 * sin(st * 0.27 + 2.3));
		vec3 col3 = sampleCrossfadedArtwork(p3, 2.25, vec2(sin(t * 0.05 + 1.0), cos(t * 0.07 + 2.0)) * 0.07);

		// Layer 4: Luminous specular sheen layer (treble & bass bloom)
		vec2 p4 = rotate2d(p, -t * 0.21 + 3.4);
		p4 = swirlCoord(p4, c4, 0.88, -torque * 1.1 * (0.7 + trebleReact * 0.6));
		vec3 col4 = sampleCrossfadedArtwork(p4, 1.32, vec2(cos(t * 0.09), sin(t * 0.08)) * 0.05);

		float d2 = smoothstep(0.15, 0.55, u_density);
		float d3 = smoothstep(0.45, 0.85, u_density);
		float d4 = smoothstep(0.65, 1.0, u_density);

		vec3 blended = mix(col1, col2, 0.46 * d2);
		blended = mix(blended, col3, 0.36 * d3);

		// Soft screen / plus-lighter luminous bloom on overlapping bright paint folds
		float bloomWeight = (0.24 + bassReact * 0.34 + u_energy * 0.14) * (0.35 + 0.65 * d4);
		vec3 screenGlow = 1.0 - (1.0 - blended) * (1.0 - col4 * bloomWeight);
		vec3 finalCol = mix(blended, screenGlow, 0.72);

		// Soft highlight rolloff so bright artwork doesn't flatten to pure white
		finalCol = finalCol / (1.0 + finalCol * 0.22);

		gl_FragColor = vec4(finalCol, 1.0);
		return;
	}

	// Apple Music iOS 18 MeshGradient fluid shader ('circles' mode or fallback before artwork loads)
	float t = u_time * 0.52;
	float st = u_swirlTime * 0.72;

	// 2-octave trigonometric fluid curl domain warp (organic non-repeating drift)
	float warpAmp = 0.075 + u_energy * 0.05 + bassReact * 0.06;
	vec2 wp = p;
	wp += vec2(
		sin(p.y * 2.35 + t * 0.91 + cos(p.x * 1.7 - st)),
		cos(p.x * 2.15 - t * 0.83 + sin(p.y * 1.9 + st))
	) * warpAmp;
	wp += vec2(
		cos(wp.y * 4.1 - st * 1.3),
		sin(wp.x * 3.8 + st * 1.15)
	) * (0.025 + trebleReact * 0.028);

	float rightBias = u_apolMode > 0.5 ? 1.0 : 0.0;
	float bassRadDelta = u_apolMode > 0.5 ? (-bassReact * 0.18) : (bassReact * 0.22);
	float trebleLuma = 1.0 + trebleReact * 0.22;

	// 6 drifting Lissajous attractors (constant uniform lookups, D3D11/ANGLE ES 1.00 safe)
	vec2 center0 = mix(vec2(-0.34, -0.18), vec2(0.08, -0.22), rightBias) * vec2(aspect, 1.0)
		+ vec2(sin(t * 0.43), cos(st * 0.61)) * vec2(0.18 * aspect, 0.16);
	vec2 center1 = mix(vec2(0.32, 0.18), vec2(0.36, 0.04), rightBias) * vec2(aspect, 1.0)
		+ vec2(cos(t * 0.57 + 1.1), sin(st * 0.47 + 0.5)) * vec2(0.16 * aspect, 0.18);
	vec2 center2 = mix(vec2(0.02, -0.30), vec2(0.18, -0.34), rightBias) * vec2(aspect, 1.0)
		+ vec2(sin(st * 0.39 + 2.2), cos(t * 0.63 + 1.7)) * vec2(0.19 * aspect, 0.15);
	vec2 center3 = mix(vec2(-0.06, 0.30), vec2(0.24, 0.30), rightBias) * vec2(aspect, 1.0)
		+ vec2(cos(t * 0.51 + 3.4), sin(st * 0.59 + 2.8)) * vec2(0.17 * aspect, 0.15);
	vec2 center4 = mix(vec2(0.36, -0.24), vec2(0.42, 0.22), rightBias) * vec2(aspect, 1.0)
		+ vec2(sin(st * 0.71 + 4.5), cos(t * 0.41 + 3.9)) * vec2(0.15 * aspect, 0.16);
	vec2 center5 = mix(vec2(-0.32, 0.26), vec2(-0.14, 0.18), rightBias) * vec2(aspect, 1.0)
		+ vec2(cos(st * 0.45 + 5.3), sin(t * 0.69 + 4.7)) * vec2(0.16 * aspect, 0.14);

	float a0 = smoothstep(0.00, 0.18, u_density);
	float a1 = smoothstep(0.16, 0.34, u_density);
	float a2 = smoothstep(0.33, 0.52, u_density);
	float a3 = smoothstep(0.50, 0.68, u_density);
	float a4 = smoothstep(0.66, 0.85, u_density);
	float a5 = smoothstep(0.82, 1.00, u_density);

	float w0 = a0 * gaussianLobe(wp, center0, max(0.28, 0.56 + bassRadDelta));
	float w1 = a1 * gaussianLobe(wp, center1, max(0.28, 0.52 + bassRadDelta * 0.9));
	float w2 = a2 * gaussianLobe(wp, center2, 0.50 + u_energy * 0.10);
	float w3 = a3 * gaussianLobe(wp, center3, 0.48 + u_energy * 0.08);
	float w4 = a4 * gaussianLobe(wp, center4, max(0.26, 0.44 + bassRadDelta * 0.75));
	float w5 = a5 * gaussianLobe(wp, center5, 0.46 + u_energy * 0.10);

	float baseWeight = 0.22;
	vec3 baseCol = u_color0 * 0.22;

	float wSum = baseWeight + w0 + w1 + w2 + w3 + w4 + w5;
	vec3 meshCol = (
		baseCol * baseWeight +
		u_color0 * w0 * (1.0 + bassReact * 0.20) +
		u_color1 * w1 * (1.0 + bassReact * 0.18) * trebleLuma +
		u_color2 * w2 * trebleLuma +
		u_color3 * w3 +
		u_color4 * w4 * (1.0 + bassReact * 0.16) * trebleLuma +
		u_color5 * w5 * trebleLuma
	) / max(wSum, 0.001);

	// Apple Music plus-lighter luminous pocket where overlapping active lobes intersect
	vec3 overlapGlow =
		u_color1 * (w0 * w1) * (0.45 + bassReact * 0.70) +
		u_color4 * (w2 * w4) * (0.35 + u_energy * 0.45);

	vec3 finalMesh = meshCol + overlapGlow;
	finalMesh = finalMesh / (1.0 + finalMesh * 0.20);

	gl_FragColor = vec4(finalMesh, 1.0);
}
`;

const PASS2_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_fboTex;
uniform vec2 u_texelSize;
uniform float u_energy;
uniform float u_bass;
uniform float u_intensity;
uniform float u_saturation;
uniform float u_density;
uniform float u_opacity;

void main() {
	// 9-tap soft Gaussian/Kawase diffusion kernel
	float spread = 1.65 + u_energy * 0.45;
	vec2 dx = vec2(u_texelSize.x * spread, 0.0);
	vec2 dy = vec2(0.0, u_texelSize.y * spread);

	vec3 col = texture2D(u_fboTex, v_uv).rgb * 4.0;
	col += texture2D(u_fboTex, v_uv + dx * 1.4).rgb * 2.0;
	col += texture2D(u_fboTex, v_uv - dx * 1.4).rgb * 2.0;
	col += texture2D(u_fboTex, v_uv + dy * 1.4).rgb * 2.0;
	col += texture2D(u_fboTex, v_uv - dy * 1.4).rgb * 2.0;
	col += texture2D(u_fboTex, v_uv + dx + dy).rgb;
	col += texture2D(u_fboTex, v_uv - dx + dy).rgb;
	col += texture2D(u_fboTex, v_uv + dx - dy).rgb;
	col += texture2D(u_fboTex, v_uv - dx - dy).rgb;
	col *= 0.0625; // / 16.0

	// Perceptual vibrancy boost + user saturation multiplier (safe at saturation == 0 -> grayscale)
	float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
	float maxChan = max(col.r, max(col.g, col.b));
	float satFactor = clamp(u_saturation * (1.28 + (1.0 - maxChan) * 0.18), 0.0, 3.8);
	col = mix(vec3(luma), col, satFactor);

	// Apple Music gentle S-curve contrast & reactive luminance breathing (preserves dark moods without crushing shadows)
	float react = clamp(u_intensity * 0.55, 0.0, 1.5);
	vec3 sCurve = col * col * (3.0 - 2.0 * clamp(col, 0.0, 1.0));
	col = mix(col, sCurve, 0.16);
	float lumGain = 0.74 + u_energy * 0.14 + clamp(u_bass * react, 0.0, 1.3) * 0.26;
	col *= lumGain;

	// Soft-shoulder compression so white lyrics & icons on Tidal remain cleanly readable
	col = col / (0.82 + col * 0.44);

	// Subtle cinematic radial edge falloff
	float edgeDist = length(v_uv - 0.5) * 1.414;
	col *= (1.0 - 0.18 * smoothstep(0.45, 1.38, edgeDist));

	// Interleaved Gradient Noise (IGN) dithering prevents 8-bit gradient banding
	float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
	col = clamp(col + (ign - 0.5) / 255.0, 0.0, 1.0);

	float alpha = clamp(u_opacity * smoothstep(0.0, 0.08, u_density), 0.0, 1.0);
	gl_FragColor = vec4(col * alpha, alpha);
}
`;

export class AppleFluidRenderer {
	public readonly isSupported: boolean = false;

	private canvas: HTMLCanvasElement;
	private gl: WebGLRenderingContext | null = null;
	private pass1Program: WebGLProgram | null = null;
	private pass2Program: WebGLProgram | null = null;
	private quadBuffer: WebGLBuffer | null = null;
	private fbo: WebGLFramebuffer | null = null;
	private fboTex: WebGLTexture | null = null;
	private texPrev: WebGLTexture | null = null;
	private texCurr: WebGLTexture | null = null;

	private u1: Pass1Uniforms | null = null;
	private u2: Pass2Uniforms | null = null;

	private fboWidth = FBO_SIZE;
	private fboHeight = FBO_SIZE;
	private displayWidth = 1280;
	private displayHeight = 720;

	private hasArtwork = false;
	private transition = 1.0;
	private lastPixels: Uint8Array | null = null;

	private currentColors = new Float32Array(18);
	private targetColors = new Float32Array(18);
	private hasInitializedPalette = false;

	private contextLost = false;
	private destroyed = false;

	private static sharedSampleCanvas: HTMLCanvasElement | null = null;

	constructor(hostContainer: HTMLElement) {
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.fboWidth;
		this.canvas.height = this.fboHeight;
		this.canvas.style.cssText = `
			position: absolute !important;
			top: 0 !important;
			left: 0 !important;
			right: 0 !important;
			bottom: 0 !important;
			width: 100% !important;
			height: 100% !important;
			pointer-events: none !important;
			display: block !important;
			z-index: 1 !important;
		`;

		this.canvas.addEventListener('webglcontextlost', this.handleContextLost, false);
		this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored, false);

		const gl = this.canvas.getContext('webgl', {
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: true,
			preserveDrawingBuffer: false,
			powerPreference: 'low-power',
		});

		if (!gl) {
			return;
		}

		this.gl = gl;
		this.seedDefaultPalette();

		if (!this.initResources(gl)) {
			this.cleanupGLResources();
			return;
		}

		hostContainer.appendChild(this.canvas);
		this.resize(hostContainer.offsetWidth || window.innerWidth, hostContainer.offsetHeight || window.innerHeight);
		this.isSupported = true;
	}

	/**
	 * Extracts pre-softened 64x64 RGBA pixels from an HTMLImageElement while immediately
	 * freeing temporary canvas GPU backing memory.
	 */
	public static extractArtworkPixels(img: HTMLImageElement): Uint8Array | null {
		const w = img.naturalWidth || img.width;
		const h = img.naturalHeight || img.height;
		if (w <= 0 || h <= 0) return null;

		const canvas = AppleFluidRenderer.sharedSampleCanvas ?? document.createElement('canvas');
		AppleFluidRenderer.sharedSampleCanvas = canvas;
		canvas.width = ARTWORK_SIZE;
		canvas.height = ARTWORK_SIZE;

		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx) {
			canvas.width = 0;
			canvas.height = 0;
			return null;
		}

		try {
			// Pre-blur slightly oversized so mirrored repeat edges stay rich without dark border bleed
			ctx.filter = 'blur(5px)';
			ctx.drawImage(img, -6, -6, ARTWORK_SIZE + 12, ARTWORK_SIZE + 12);
			ctx.filter = 'none';
			const imgData = ctx.getImageData(0, 0, ARTWORK_SIZE, ARTWORK_SIZE);
			return new Uint8Array(imgData.data);
		} catch {
			return null;
		} finally {
			canvas.width = 0;
			canvas.height = 0;
		}
	}

	private seedDefaultPalette(): void {
		const defaults = [
			0.18, 0.22, 0.34,
			0.26, 0.32, 0.48,
			0.14, 0.26, 0.38,
			0.24, 0.18, 0.36,
			0.30, 0.36, 0.52,
			0.12, 0.16, 0.28,
		];
		this.currentColors.set(defaults);
		this.targetColors.set(defaults);
	}

	private initResources(gl: WebGLRenderingContext): boolean {
		gl.disable(gl.BLEND);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.CULL_FACE);

		const pass1 = this.createProgram(gl, VERTEX_SHADER, PASS1_FRAGMENT_SHADER);
		const pass2 = this.createProgram(gl, VERTEX_SHADER, PASS2_FRAGMENT_SHADER);
		if (!pass1 || !pass2) return false;

		this.pass1Program = pass1;
		this.pass2Program = pass2;

		this.quadBuffer = gl.createBuffer();
		if (!this.quadBuffer) return false;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
			gl.STATIC_DRAW
		);

		this.u1 = {
			resolution: gl.getUniformLocation(pass1, 'u_resolution'),
			time: gl.getUniformLocation(pass1, 'u_time'),
			swirlTime: gl.getUniformLocation(pass1, 'u_swirlTime'),
			bass: gl.getUniformLocation(pass1, 'u_bass'),
			energy: gl.getUniformLocation(pass1, 'u_energy'),
			treble: gl.getUniformLocation(pass1, 'u_treble'),
			intensity: gl.getUniformLocation(pass1, 'u_intensity'),
			density: gl.getUniformLocation(pass1, 'u_density'),
			apolMode: gl.getUniformLocation(pass1, 'u_apolMode'),
			mode: gl.getUniformLocation(pass1, 'u_mode'),
			hasArtwork: gl.getUniformLocation(pass1, 'u_hasArtwork'),
			transition: gl.getUniformLocation(pass1, 'u_transition'),
			texPrev: gl.getUniformLocation(pass1, 'u_texPrev'),
			texCurr: gl.getUniformLocation(pass1, 'u_texCurr'),
			color0: gl.getUniformLocation(pass1, 'u_color0'),
			color1: gl.getUniformLocation(pass1, 'u_color1'),
			color2: gl.getUniformLocation(pass1, 'u_color2'),
			color3: gl.getUniformLocation(pass1, 'u_color3'),
			color4: gl.getUniformLocation(pass1, 'u_color4'),
			color5: gl.getUniformLocation(pass1, 'u_color5'),
		};

		this.u2 = {
			fboTex: gl.getUniformLocation(pass2, 'u_fboTex'),
			texelSize: gl.getUniformLocation(pass2, 'u_texelSize'),
			energy: gl.getUniformLocation(pass2, 'u_energy'),
			bass: gl.getUniformLocation(pass2, 'u_bass'),
			intensity: gl.getUniformLocation(pass2, 'u_intensity'),
			saturation: gl.getUniformLocation(pass2, 'u_saturation'),
			density: gl.getUniformLocation(pass2, 'u_density'),
			opacity: gl.getUniformLocation(pass2, 'u_opacity'),
		};

		// Offscreen POT FBO + clamp-to-edge texture
		this.fboTex = gl.createTexture();
		this.fbo = gl.createFramebuffer();
		if (!this.fboTex || !this.fbo) return false;

		gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.fboWidth, this.fboHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
		const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		if (status !== gl.FRAMEBUFFER_COMPLETE) {
			console.warn('[reactivo] WebGL FBO incomplete:', status);
			return false;
		}

		// Power-of-two 64x64 artwork textures with MIRRORED_REPEAT
		const blankPixels = new Uint8Array(ARTWORK_SIZE * ARTWORK_SIZE * 4);
		for (let i = 0; i < blankPixels.length; i += 4) {
			blankPixels[i] = 18;
			blankPixels[i + 1] = 20;
			blankPixels[i + 2] = 26;
			blankPixels[i + 3] = 255;
		}

		this.texPrev = this.createArtworkTexture(gl, this.lastPixels ?? blankPixels);
		this.texCurr = this.createArtworkTexture(gl, this.lastPixels ?? blankPixels);
		if (!this.texPrev || !this.texCurr) return false;

		return true;
	}

	private createArtworkTexture(gl: WebGLRenderingContext, pixels: Uint8Array): WebGLTexture | null {
		const tex = gl.createTexture();
		if (!tex) return null;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ARTWORK_SIZE, ARTWORK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
		return tex;
	}

	private createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
		const vs = this.compileShader(gl, gl.VERTEX_SHADER, vsSource);
		const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
		if (!vs || !fs) {
			if (vs) gl.deleteShader(vs);
			if (fs) gl.deleteShader(fs);
			return null;
		}

		const program = gl.createProgram();
		if (!program) {
			gl.deleteShader(vs);
			gl.deleteShader(fs);
			return null;
		}

		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.bindAttribLocation(program, 0, 'a_position');
		gl.linkProgram(program);

		// Shaders are no longer needed once linked
		gl.deleteShader(vs);
		gl.deleteShader(fs);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			console.warn('[reactivo] WebGL program link error:', gl.getProgramInfoLog(program));
			gl.deleteProgram(program);
			return null;
		}

		return program;
	}

	private compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, source);
		gl.compileShader(shader);
		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			console.warn('[reactivo] WebGL shader compile error:', gl.getShaderInfoLog(shader));
			gl.deleteShader(shader);
			return null;
		}
		return shader;
	}

	public resize(containerWidth: number, containerHeight: number): void {
		if (this.destroyed || !this.gl || this.contextLost) return;
		this.displayWidth = Math.max(128, containerWidth);
		this.displayHeight = Math.max(128, containerHeight);
		if (this.canvas.width !== this.fboWidth || this.canvas.height !== this.fboHeight) {
			this.canvas.width = this.fboWidth;
			this.canvas.height = this.fboHeight;
		}
	}

	public setArtworkPixels(pixels: Uint8Array): void {
		if (this.destroyed || pixels.length !== ARTWORK_SIZE * ARTWORK_SIZE * 4) return;
		const gl = this.gl;
		if (!gl || this.contextLost || !this.texPrev || !this.texCurr) {
			this.lastPixels = new Uint8Array(pixels);
			this.hasArtwork = true;
			return;
		}

		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		if (!this.hasArtwork || !this.lastPixels) {
			gl.bindTexture(gl.TEXTURE_2D, this.texPrev);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ARTWORK_SIZE, ARTWORK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			gl.bindTexture(gl.TEXTURE_2D, this.texCurr);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ARTWORK_SIZE, ARTWORK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			this.transition = 1.0;
		} else {
			gl.bindTexture(gl.TEXTURE_2D, this.texPrev);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ARTWORK_SIZE, ARTWORK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.lastPixels);
			gl.bindTexture(gl.TEXTURE_2D, this.texCurr);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ARTWORK_SIZE, ARTWORK_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
			this.transition = 0.0;
		}
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

		this.lastPixels = new Uint8Array(pixels);
		this.hasArtwork = true;
	}

	public setPalette(paletteRgbStrings: string[]): void {
		if (!paletteRgbStrings || paletteRgbStrings.length === 0) return;

		const parsed: Array<[number, number, number]> = [];
		for (let i = 0; i < paletteRgbStrings.length; i++) {
			const match = paletteRgbStrings[i].match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
			if (match) {
				parsed.push([
					Math.min(255, Math.max(0, Number(match[1]))) / 255,
					Math.min(255, Math.max(0, Number(match[2]))) / 255,
					Math.min(255, Math.max(0, Number(match[3]))) / 255,
				]);
			}
		}
		if (parsed.length === 0) return;

		for (let slot = 0; slot < 6; slot++) {
			const src = parsed[slot % parsed.length];
			// Add gentle contrast variation if cycling reused colors on sparse palettes
			const cycleShift = slot >= parsed.length ? (slot % 2 === 0 ? 1.15 : 0.78) : 1.0;
			const offset = slot * 3;
			this.targetColors[offset] = Math.min(1, src[0] * cycleShift);
			this.targetColors[offset + 1] = Math.min(1, src[1] * cycleShift);
			this.targetColors[offset + 2] = Math.min(1, src[2] * cycleShift);
		}

		if (!this.hasInitializedPalette) {
			this.currentColors.set(this.targetColors);
			this.hasInitializedPalette = true;
		}
	}

	public render(params: FluidRenderParams): void {
		if (this.destroyed || !this.isSupported || this.contextLost) return;
		const gl = this.gl;
		if (!gl || !this.pass1Program || !this.pass2Program || !this.u1 || !this.u2 || !this.fbo) return;

		const clampedDt = Math.max(0.001, Math.min(params.dt || 0.016, 0.1));

		// Smooth crossfade for palette colors (~1.1s settle)
		const colorLerp = 1 - Math.exp(-clampedDt * 2.4);
		for (let i = 0; i < 18; i++) {
			this.currentColors[i] += (this.targetColors[i] - this.currentColors[i]) * colorLerp;
		}

		// Smooth crossfade for artwork textures (~1.15s)
		if (this.transition < 1.0) {
			this.transition = Math.min(1.0, this.transition + clampedDt / 1.15);
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		// --- PASS 1: Render fluid composition to offscreen FBO ---
		gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
		gl.viewport(0, 0, this.fboWidth, this.fboHeight);
		gl.useProgram(this.pass1Program);

		const u1 = this.u1;
		gl.uniform2f(u1.resolution, this.displayWidth, this.displayHeight);
		gl.uniform1f(u1.time, params.time);
		gl.uniform1f(u1.swirlTime, params.swirlTime);
		gl.uniform1f(u1.bass, params.bass);
		gl.uniform1f(u1.energy, params.energy);
		gl.uniform1f(u1.treble, params.treble);
		gl.uniform1f(u1.intensity, params.intensity);
		gl.uniform1f(u1.density, params.density);
		gl.uniform1f(u1.apolMode, params.apolMode ? 1.0 : 0.0);
		gl.uniform1f(u1.mode, params.mode === 'images' ? 1.0 : 0.0);
		gl.uniform1f(u1.hasArtwork, this.hasArtwork ? 1.0 : 0.0);
		gl.uniform1f(u1.transition, this.transition);

		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.texPrev);
		gl.uniform1i(u1.texPrev, 0);

		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, this.texCurr);
		gl.uniform1i(u1.texCurr, 1);

		const c = this.currentColors;
		gl.uniform3f(u1.color0, c[0], c[1], c[2]);
		gl.uniform3f(u1.color1, c[3], c[4], c[5]);
		gl.uniform3f(u1.color2, c[6], c[7], c[8]);
		gl.uniform3f(u1.color3, c[9], c[10], c[11]);
		gl.uniform3f(u1.color4, c[12], c[13], c[14]);
		gl.uniform3f(u1.color5, c[15], c[16], c[17]);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

		// --- PASS 2: Soft diffusion blur + Apple grade + IGN dithering to Screen ---
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.useProgram(this.pass2Program);

		const u2 = this.u2;
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
		gl.uniform1i(u2.fboTex, 0);

		const aspect = this.displayWidth / Math.max(1, this.displayHeight);
		gl.uniform2f(u2.texelSize, (1.0 / this.fboWidth) / Math.max(aspect, 0.5), 1.0 / this.fboHeight);
		gl.uniform1f(u2.energy, params.energy);
		gl.uniform1f(u2.bass, params.bass);
		gl.uniform1f(u2.intensity, params.intensity);
		gl.uniform1f(u2.saturation, params.saturation);
		gl.uniform1f(u2.density, params.density);
		gl.uniform1f(u2.opacity, params.opacity);

		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindTexture(gl.TEXTURE_2D, null);
	}

	public getDebugInfo(): {
		isSupported: boolean;
		contextLost: boolean;
		fboWidth: number;
		fboHeight: number;
		hasArtwork: boolean;
		transition: number;
	} {
		return {
			isSupported: this.isSupported,
			contextLost: this.contextLost,
			fboWidth: this.fboWidth,
			fboHeight: this.fboHeight,
			hasArtwork: this.hasArtwork,
			transition: this.transition,
		};
	}

	private handleContextLost = (e: Event): void => {
		e.preventDefault();
		this.contextLost = true;
	};

	private handleContextRestored = (): void => {
		if (this.destroyed || !this.gl) return;
		this.contextLost = false;
		if (this.initResources(this.gl) && this.fboTex) {
			this.gl.bindTexture(this.gl.TEXTURE_2D, this.fboTex);
			this.gl.texImage2D(
				this.gl.TEXTURE_2D,
				0,
				this.gl.RGBA,
				this.fboWidth,
				this.fboHeight,
				0,
				this.gl.RGBA,
				this.gl.UNSIGNED_BYTE,
				null
			);
		}
	};

	private cleanupGLResources(): void {
		const gl = this.gl;
		if (!gl) return;
		if (this.pass1Program) gl.deleteProgram(this.pass1Program);
		if (this.pass2Program) gl.deleteProgram(this.pass2Program);
		if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
		if (this.fboTex) gl.deleteTexture(this.fboTex);
		if (this.texPrev) gl.deleteTexture(this.texPrev);
		if (this.texCurr) gl.deleteTexture(this.texCurr);
		if (this.fbo) gl.deleteFramebuffer(this.fbo);

		this.pass1Program = null;
		this.pass2Program = null;
		this.quadBuffer = null;
		this.fboTex = null;
		this.texPrev = null;
		this.texCurr = null;
		this.fbo = null;
	}

	public destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;

		this.canvas.removeEventListener('webglcontextlost', this.handleContextLost, false);
		this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored, false);

		this.cleanupGLResources();

		if (this.gl) {
			try {
				this.gl.getExtension('WEBGL_lose_context')?.loseContext();
			} catch { }
			this.gl = null;
		}

		if (this.canvas.parentNode) {
			this.canvas.parentNode.removeChild(this.canvas);
		}

		this.lastPixels = null;
		this.u1 = null;
		this.u2 = null;
	}
}
