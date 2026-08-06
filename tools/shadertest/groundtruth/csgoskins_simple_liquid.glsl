// csgoskins.gg's port of csgo_simple_liquid, lifted from their public
// skin-viewer bundle (build/assets/skin-viewer-*.js) on 2026-08-05.
//
// WHY THIS IS HERE. It is an INDEPENDENT port of the same Valve shader we
// transcribed in src/charmLiquid.ts — same decompiler, same temporaries
// (_14119, _309123._30978) — but with the variables named and, crucially, with
// their answers to the two things the decompile CANNOT tell you: what drives
// g_flTestAgitation, and what the bubbles do with it.
//
// Read alongside groundtruth/liquid_outer_combo12.glsl (Valve's own, authoritative
// for the maths) — this one is authoritative for nothing, but it is a second
// opinion from someone who shipped a version that looks right.

// ==================== FRAGMENT (uniforms + body) ====================
if
#if defined(SIMPLE_LIQUID)
uniform sampler2D g_tLiquidMask;
uniform float g_flMaskMinimum;
uniform float g_flMaskMaximum;
uniform float g_flLiquidWobbleSpeed;
uniform float g_flLiquidWobbleScale;
uniform float g_flLiquidWobbleWavelength;
uniform float g_flLiquidLevelHeight;
uniform float g_flLiquidLevelHeightDelta;
uniform vec3 g_vLiquidLevelUpwardsMinMidMax;
uniform vec3 g_vLiquidLevelDownwardsMinMidMax;
uniform vec3 g_vLiquidLevelSidewardsMinMidMax;
uniform vec3 g_vLiquidColor; 
uniform float g_flLiquidBrightness;
uniform float g_flLiquidInnerGlow;
uniform float g_flLiquidEmissiveStrength;
uniform float g_flSurfaceTension;
uniform float g_flLiquidSharpness;
uniform float g_flBrightenEmptyArea;
uniform float g_flLiquidBackOffset;
uniform float g_flLiquidBackFade;
uniform float g_flWaterLineStrength;
uniform float g_flFresnelGlassThickness;
uniform float g_flTransmissiveStrength;
uniform float g_flLiquidSpecularStrength;
uniform float g_flLiquidSurfaceSpecularStrength;
uniform float g_flLiquidRoughness;
uniform float g_flLiquidBackCylinderOrSphere;
uniform float g_flLiquidColorHueShift;
uniform float g_flCubeRefractTransparency;
uniform float g_flCubeRefractLiquidTransparency;
uniform float g_flCubeRefractBrightness;
uniform float g_flRefractRoughnessMultiplier;
uniform float g_flGlassRefraction;
uniform float g_flLiquidRefraction;
uniform float g_flLiquidSurfaceRefraction;
uniform float g_flBubbleDepthFalloff;
uniform float g_flBubbleOpacity;
uniform float g_flBubbleScale;
uniform float g_flBubbleSpaceScale;
uniform float g_flBubbleSpeed;
uniform float g_flBubbleStrength;
uniform float g_flBubblesMaximum;
uniform float g_flBubblesMinimum;
uniform vec3 g_vBubbleColorInner; 
uniform vec3 g_vBubbleColorOuter; 
uniform float g_flTestAgitation;
uniform vec3 g_vTestGravityDir;
varying vec3 _30944;
varying vec3 _30948;
varying float _30945;
varying vec3 _30946;
varying vec3 _30949;
varying vec3 _30950;
varying vec3 _30951;
varying vec4 _30952;
void _30936(inout _30900 _309123, vec2 texCoord)
{
	#define input_11 vec4(1.0)
	#define vViewDir -_309123._30902
	#define _30937 _309123._30986
	vec3 matWorldPos = vWorldPosition.xyz * (1.0/0.0254);
	vec3 vGravityDir = normalize(_30949);
	float liquidMaskSample = texture(g_tLiquidMask, texCoord.xy).x;
	float liquidMask = saturate(
		(liquidMaskSample - g_flMaskMinimum) * 
		(1.0 / (g_flMaskMaximum + 0.001)) 
	);
	vec3 viewDirInv = -vViewDir;
	float fresnelFactor = clamp(1.0 - dot(viewDirInv, _309123._30998), 0.0, 1.0);
	float glassThicknessFactor = clamp(2.0 * (fresnelFactor - g_flFresnelGlassThickness), 0.0, 1.0);
	vec3 _14119 = _309123._30978 * mix(vec3(1.0), vec3(0.2), vec3(glassThicknessFactor * liquidMask));
	vec4 _30930;
	_30930.x = _14119.x;
	_30930.y = _14119.y;
	_30930.z = _14119.z;
	float _12833 = (3.0 * _30945) * floor(g_flLiquidWobbleSpeed * 200.0);
	float _5292 = _12833 * 0.005;
	float agitationInput = mix(0.9, 0.7, saturate(pow((g_flTime - 5.0) / 10.0, 2.0))); 
	float agitationBase = pow(agitationInput, 2.0) + 0.01;
	float agitationBubbles = pow(agitationInput, 9.0);
	vec3 vPositionOs = _30944.xyz;
	vPositionOs.z = _30944.z * g_flLiquidBackCylinderOrSphere;
	vec3 viewSpaceOffset = (_30951.xyz - _30952.xyz) / 0.0254;
	vec3 viewGravityDir2D = normalize(vec3(_30950.xy, 0.0));
	float _6473 = dot(viewSpaceOffset, cross(viewGravityDir2D, vec3(0.0, 0.0, 1.0)));
	float _7602 = dot(viewSpaceOffset, viewGravityDir2D);
	vec3 _7986;
	_7986.x = _6473;
	_7986.y = _7602;
	vec3 vGravityDirInv = -vGravityDir;
	float _30940 = dot(normalize(_30946), vGravityDirInv);
	vec3 _15143 = mix(mix(g_vLiquidLevelDownwardsMinMidMax, g_vLiquidLevelSidewardsMinMidMax, vec3(saturate(_30940 + 1.0))), g_vLiquidLevelUpwardsMinMidMax, vec3(saturate(_30940)));
	float _8437 = ((1.0 - g_flLiquidLevelHeightDelta) + (g_flLiquidLevelHeightDelta * input_11.x)) * g_flLiquidLevelHeight;
	float _17433 = mix(mix(_15143.x, _15143.y, saturate(_8437 * 2.0)), _15143.z, clamp((_8437 - 0.5) * 2.0, 0.0, 1.0)) + dot(_30948, vGravityDirInv);
	float _22288 = length(_309123._30998 * vGravityDirInv);
	float _4623 = ((fresnelFactor * mix(0.25, 1.0, _22288)) + (pow(fresnelFactor, 5.0) * 0.8)) * g_flSurfaceTension;
	float _14290 = mix(0.5, 1.0, abs(_30940));
	float _4122 = (g_flLiquidWobbleWavelength * _14290) * mix(0.2, 0.6, agitationBase);
	float _14276 = _12833 * 0.104;
	float _17945 = 1.0 - _22288;
	float _14277 = _12833 * (-0.104);
	float _23968 = ((((((((agitationBase * exp(sin(dot(vec2(-1.24211, 1.142074) * _4122, _7986.xy) + (_12833 * 0.034)) - 1.0)) * 0.125) + (exp(sin(dot(vec2(2.82101, 2.92074) * _4122, _7986.xy) + (_12833 * 0.044)) - 1.0) * 0.333333)) + ((agitationBase * exp(sin(dot(vec2(-3.2421100139617919921875, -3.642074108123779296875) * _4122, _7986.xy) + (_12833 * 0.024)) - 1.0)) * 0.111111)) + ((agitationBase * exp(sin(dot(vec2(3.742110, -3.6420741) * _4122, _7986.xy) + (_12833 * 0.029)) - 1.0)) * 0.111111)) * exp((sin(dot(vec2(-8.74211025238037109375, 13.64207363128662109375) * _4122, _7986.xy) + _14276) * _17945) * 0.14)) * exp((sin(dot(vec2(13.74211025238037109375, 14.64207363128662109375) * _4122, _7986.xy) + _14277) * _17945) * 0.12999999)) * exp((sin(dot(vec2(-23.7421092987060546875, -13.64207363128662109375) * _4122, _7986.xy) + _14276) * _17945) * 0.1)) * exp((sin(dot(vec2(31.7421092987060546875, -20.6420745849609375) * _4122, _7986.xy) + _14277) * _17945) * 0.08);
	float _3143 = (((((_23968 * g_flLiquidWobbleScale) * pow(agitationBase, 2.0)) * _14290) * 15.0) * (1.5 - fresnelFactor)) - (agitationBase * 0.25);
	float surfaceDepth = dot(matWorldPos, vGravityDirInv);
	float _30939 = dot(vViewDir, vGravityDir);
	vec2 _8199 = (vec2(_6473, _7602) * g_flBubbleSpaceScale).xy + ((_309123._30985.xy - vec2(0.5)) * vec2(0.25));
	float _8867 = _8199.x;
	float flBubbleAlpha = (1.5 * (g_flBubbleScale * mix(g_flBubblesMinimum, g_flBubblesMaximum, agitationBubbles + (input_11.y * 0.25)))) / (1.0 + abs((((_17433 + _4623) + _3143) - surfaceDepth) * g_flBubbleDepthFalloff));
	float _23496 = (_8199.y + ((0.4 * _3143) * flBubbleAlpha)) + (((-0.0004) * (surfaceDepth - surfaceDepth)) * flBubbleAlpha);
	vec2 _8159 = _8199;
	_8159.y = _23496;
	float _5823 = (sin(_23496) * 0.25) + (sin(_23496 * 23.1984) * 0.02);
	float _3752 = (sin(_8867 * 1.294) * 0.25) + (sin(_8867 * 18.1984) * 0.04);
	float _5580 = 4.0 * (1.0 - _30937);
	float _9501 = 1.0 / max(flBubbleAlpha, 0.001);
	vec2 _8382 = ((fract((((_8159 + vec2(0.2 - _5823, 0.356 + _3752)) * 0.6) + (((vec2(0.1, 1.0) * _5292) * 0.25) * g_flBubbleSpeed)) * 1.74) * 2.0) - vec2(1.0)) * _9501;
	float _22266 = length(_8382);
	float _14443 = clamp(_5580 * (1.0 - _22266), 0.0, 1.0);
	vec2 _20855 = _8382 * pow(_22266, 2.0);
	vec2 _15571 = ((fract((((_8159 + vec2((-0.2) + _5823, (-0.56) - _3752)) * 0.55) + (((vec2(-0.1, 1.0) * _5292) * 0.3) * g_flBubbleSpeed)) * 2.74) * 2.0) - vec2(1.0)) * _9501;
	float _21462 = length(_15571);
	float _14444 = clamp(_5580 * (1.0 - _21462), 0.0, 1.0);
	vec2 _23695 = _15571 * pow(_21462, 2.0);
	float _11723 = _14443 + _14444;
	float _15087 = _5823 * 0.5;
	float _9552 = _3752 * 0.5;
	vec2 _15572 = ((fract((((_8159 + vec2(0.35 - _15087, 0.6 - _9552)) * 0.5) + (((vec2(0.13, 1.0) * _5292) * 0.35) * g_flBubbleSpeed)) * 4.74) * 2.0) - vec2(1.0)) * _9501;
	float _21463 = length(_15572);
	float _14445 = clamp(_5580 * (1.0 - _21463), 0.0, 1.0);
	vec2 _23696 = _15572 * pow(_21463, 2.0);
	float _11724 = _11723 + _14445;
	vec2 _15574 = ((fract((((_8159 + vec2((-0.42) + _15087, (-0.76) + _9552)) * 0.45) + (((vec2(-0.14, 1.0) * _5292) * 0.4) * g_flBubbleSpeed)) * 5.34) * 2.0) - vec2(1.0)) * _9501;
	float _21464 = length(_15574);
	float _14446 = clamp(_5580 * (1.0 - _21464), 0.0, 1.0);
	vec2 _23697 = _15574 * pow(_21464, 2.0);
	vec3 _23013 = vec4(vec4(vec4(mix(SrgbGammaToLinear(g_vBubbleColorInner), SrgbGammaToLinear(g_vBubbleColorOuter), vec3(length(_20855))) * _14443, _14443).xyz + (mix(g_vBubbleColorInner, g_vBubbleColorOuter, vec3(length(_23695))) * _14444), _11723).xyz + (mix(g_vBubbleColorInner, g_vBubbleColorOuter, vec3(length(_23696))) * _14445), _11724).xyz + (mix(g_vBubbleColorInner, g_vBubbleColorOuter, vec3(length(_23697))) * _14446);
	float _19498 = (_11724 + _14446) * flBubbleAlpha;
	float _3921 = ((_17433 + _3143) + (_19498 * 0.025)) + (abs(_30939) * (-0.05));
	float _4095 = (g_flLiquidSharpness * liquidMask) * mix(1.0, 0.2, pow(_309123._30986, 1.5));
	float _5526 = surfaceDepth - ((_3921 + _4623) + mix(0.0, min(0.3, clamp(1.0 - abs(vGravityDir.y), 0.0, 1.0)) * (fresnelFactor - 0.2), 1.5));
	float viewEdgeFactor = 1.0 - fresnelFactor;
	float viewEdgeFactorSq = pow(viewEdgeFactor, 2.0);
	float _30941 = ((1.0 - clamp((abs(_5526 - 0.05) * viewEdgeFactorSq) * _4095, 0.0, 1.0)) * viewEdgeFactorSq) * g_flWaterLineStrength;
	float _30942 = clamp((_5526 * _4095) * 0.25, 0.0, 1.0);
	float _30943 = 1.0 - _30942;
	float _5854 = (((1.5 * g_flLiquidBackOffset) * pow(saturate(_30939), 2.0)) * viewEdgeFactor) * length(vPositionOs.xyz);
	float _14945 = _5526 - _5854;
	float _5952 = 1.0 - clamp((_14945 * _4095) * 0.125, 0.0, 1.0);
	float _5461 = 1.0 - clamp((saturate(_5526) * g_flLiquidBackFade) * 0.5, 0.0, 1.0);
	float _7534 = _5952 * _5461;
	float _30933 = clamp((_30941 + _30943) + _7534, 0.0, 1.0);
	float _30934 = clamp((_7534 - _30943) * liquidMask, 0.0, 1.0);
	float _21761 = saturate(_30933 * liquidMask);
	float _9466 = saturate(_30943);
	vec2 _30935 = (((((_20855 * _14443) + (_23695 * _14444)) + (_23696 * _14445)) + (_23697 * _14446)) * flBubbleAlpha) * _9466;
	float flWaterLineInverse = 1.0 - _30941;
	vec3 _30932 = (SrgbGammaToLinear(g_vLiquidColor) * g_flLiquidBrightness) * saturate(flWaterLineInverse);
	vec3 vBubbleColor = mix(vec3(1.0), vec4(_23013, _19498).xyz * 4.0, vec3(clamp(g_flBubbleOpacity * (_19498 * _9466), 0.0, 1.0)));
	vec3 _4789 = _30910(_30932, g_flLiquidColorHueShift) * vBubbleColor;
	_30932 = _30930.xyz * mix(vec3(1.0), _4789, vec3(_21761));
	_30932 = _30932.xyz + (((((_4789 * g_flLiquidBrightness) * pow(viewEdgeFactor, 3.0)) * _21761) / vec3(1.0 + max(_3921 - surfaceDepth, 0.0))) * g_flLiquidInnerGlow);
	vec3 _30931 = _30932.xyz * (1.0 + ((g_flBrightenEmptyArea * liquidMask) * saturate(1.0 - _30933)));
	vec3 vCameraUp = normalize(inverse(mat3(viewMatrix))[1]);
	vec3 _30929 = normalize(mix(normalize(mix(_309123._30998, viewDirInv, vec3(-0.3)) + (((vCameraUp * _30935.y) + (cross(vCameraUp, vViewDir) * _30935.x)) * g_flBubbleStrength)), normalize(vGravityDirInv + vec3(_3143 * 0.5, 0.0, 0.0)), vec3(((clamp(1.0 - ((saturate(_5526) - saturate(_14945)) * 0.5), 0.0, 1.0) * saturate(_30933)) * _30934) * (0.25 + (_5461 * 0.6666666)))) * 1.1);
	float flRefractionAmount = mix(mix(g_flGlassRefraction, g_flLiquidRefraction, _30933), g_flLiquidSurfaceRefraction, _30934);
	float flGlassThicknessInverse = 1.0 - glassThicknessFactor;
	vec2 _30938 = vec2(_30937);
	_309123._30978 = vec3(_30931.xyz);
	if (false)
	{
		_309123._30978 = max(vec3(_30929), vec3(0.0));
	}
	_309123._30998 = mix(_309123._30998, _30929, _21761 * (1.0 - _30934));
	_309123._30981 = 1.0;
	_309123._30978 = min(_309123._30978, vec3(1.0));
	_309123._30984 *= mix(1.0, 0.5, liquidMask);
}
#endif

// ==================== VERTEX varyings ====================
if
#if defined(SIMPLE_LIQUID)
	varying vec3 _30944;
	varying vec3 _30948;
	varying float _30945;
	varying vec3 _30946;
	varying vec3 _30949;
	varying vec3 _30950;
	varying vec3 _30951;
	varying vec4 _30952;
	uniform vec3 g_vTestGravityDir;
	uniform vec3 g_vLiquidLevelUpwardsMinMidMax;
	uniform vec3 g_flLiquidCenterOffset;
#endif

// ==================== VERTEX body ====================
z;
#if defined(SIMPLE_LIQUID)
	#define vVertexColorOut vec4(1.0)
	vec3 vGravityDir;
	if (false )
	{
		vGravityDir = normalize(g_vTestGravityDir);
	}
	else
	{
		vGravityDir = vec3(0, -1, 0);
	}
	const float meterToInchMultiplier = 1.0 / 0.0254;
	mat4 liquidMatrix = mat4(1.0);
	mat4 modelMatrixInches = mat4(meterToInchMultiplier) * modelMatrix;
	liquidMatrix = modelMatrixInches * liquidMatrix;
	liquidMatrix[3].y += 0.3;
	_30944 = (position - g_flLiquidCenterOffset);
	_30945 = fract((g_flTime + vVertexColorOut.x) * 0.005) * 200.0;
	_30946 = (liquidMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
	vec3 _30947 = (liquidMatrix * vec4(g_flLiquidCenterOffset, 1.0)).xyz;
	_30948 = _30947;
	_30949 = vGravityDir;
	_30950 = (viewMatrix * vec4(vGravityDir, 0.0)).xyz;
	_30951 = (viewMatrix * worldPosition).xyz;
	_30952 = (viewMatrix * vec4(_30947.xyz, 1.0));
#endif
