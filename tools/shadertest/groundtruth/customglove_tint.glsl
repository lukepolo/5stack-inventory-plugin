// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 3 (name: g_mSubstrateColorAdjust1) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (92156 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup
// Static combos: S_BACKWARDS_COMPATIBILITY, S_TINT_ID

#version 460
#extension GL_EXT_samplerless_texture_functions : require
#if defined(GL_EXT_control_flow_attributes)
#extension GL_EXT_control_flow_attributes : require
#define SPIRV_CROSS_FLATTEN [[flatten]]
#define SPIRV_CROSS_BRANCH [[dont_flatten]]
#define SPIRV_CROSS_UNROLL [[unroll]]
#define SPIRV_CROSS_LOOP [[dont_unroll]]
#else
#define SPIRV_CROSS_FLATTEN
#define SPIRV_CROSS_BRANCH
#define SPIRV_CROSS_UNROLL
#define SPIRV_CROSS_LOOP
#endif

const vec2 _1555[9] = vec2[](vec2(-1.0), vec2(0.0, -1.0), vec2(1.0, -1.0), vec2(-1.0, 0.0), vec2(0.0), vec2(1.0, 0.0), vec2(-1.0, 1.0), vec2(0.0, 1.0), vec2(1.0));
float _2;
float _3;
vec3 _4;

struct _1082
{
    int g_bPattern;
    int g_nOutputMode;
    mat4 g_mSurfaceColorAdjust1;
    mat4 g_mSubstrateColorAdjust1;
    float g_fSubstrateCompositeColorTranslucency1;
    float g_fDamageUvScale1;
    float g_fDamageHeightBlendSoftness1;
    vec2 g_vDamageMinMax1;
    int g_bDamageBevelUseTintMask1;
    mat4 g_mDamageColorAdjust1;
    float g_fDamageBevelBlendSoftness1;
    float g_fDamageBevelEmboss1;
    float g_fDamageBevelRoughnessBrightness1;
    float g_fDamageBevelAnisotropy1;
    float g_fDamageBevelMetalness1;
    float g_fDamageBevelCloth1;
    int g_bDamageBevelBlendToSubstrate1;
    float g_fBurnishingMetalness1;
    float g_fBurnishingCloth1;
    mat4 g_mSurfaceBurnishingColorAdjust1;
    mat4 g_mSubstrateBurnishingColorAdjust1;
    float g_fBurnishingNormalScale1;
    float g_fSurfaceBurnishingRoughnessBrightness1;
    float g_fSubstrateBurnishingRoughnessBrightness1;
    vec2 g_vSurfaceBurnishingMinMax1;
    vec2 g_vSubstrateBurnishingMinMax1;
    float g_fGrimeUvScale1;
    float g_fGrimeTranslucency1;
    float g_fGrimeRoughnessBrightness1;
    vec2 g_vSurfaceGrimeMinMax1;
    vec2 g_vSubstrateGrimeMinMax1;
    float g_fBurnishingGrime1;
    mat4 g_mSurfaceColorAdjust2;
    mat4 g_mSubstrateColorAdjust2;
    float g_fSubstrateCompositeColorTranslucency2;
    float g_fDamageUvScale2;
    float g_fDamageHeightBlendSoftness2;
    vec2 g_vDamageMinMax2;
    int g_bDamageBevelUseTintMask2;
    mat4 g_mDamageColorAdjust2;
    float g_fDamageBevelBlendSoftness2;
    float g_fDamageBevelEmboss2;
    float g_fDamageBevelRoughnessBrightness2;
    float g_fDamageBevelAnisotropy2;
    float g_fDamageBevelMetalness2;
    float g_fDamageBevelCloth2;
    int g_bDamageBevelBlendToSubstrate2;
    float g_fBurnishingMetalness2;
    float g_fBurnishingCloth2;
    mat4 g_mSurfaceBurnishingColorAdjust2;
    mat4 g_mSubstrateBurnishingColorAdjust2;
    float g_fBurnishingNormalScale2;
    float g_fSurfaceBurnishingRoughnessBrightness2;
    float g_fSubstrateBurnishingRoughnessBrightness2;
    vec2 g_vSurfaceBurnishingMinMax2;
    vec2 g_vSubstrateBurnishingMinMax2;
    float g_fGrimeUvScale2;
    float g_fGrimeTranslucency2;
    float g_fGrimeRoughnessBrightness2;
    vec2 g_vSurfaceGrimeMinMax2;
    vec2 g_vSubstrateGrimeMinMax2;
    float g_fBurnishingGrime2;
    mat4 g_mSurfaceColorAdjust3;
    mat4 g_mSubstrateColorAdjust3;
    float g_fSubstrateCompositeColorTranslucency3;
    float g_fDamageUvScale3;
    float g_fDamageHeightBlendSoftness3;
    vec2 g_vDamageMinMax3;
    int g_bDamageBevelUseTintMask3;
    mat4 g_mDamageColorAdjust3;
    float g_fDamageBevelBlendSoftness3;
    float g_fDamageBevelEmboss3;
    float g_fDamageBevelRoughnessBrightness3;
    float g_fDamageBevelAnisotropy3;
    float g_fDamageBevelMetalness3;
    float g_fDamageBevelCloth3;
    int g_bDamageBevelBlendToSubstrate3;
    float g_fBurnishingMetalness3;
    float g_fBurnishingCloth3;
    mat4 g_mSurfaceBurnishingColorAdjust3;
    mat4 g_mSubstrateBurnishingColorAdjust3;
    float g_fBurnishingNormalScale3;
    float g_fSurfaceBurnishingRoughnessBrightness3;
    float g_fSubstrateBurnishingRoughnessBrightness3;
    vec2 g_vSurfaceBurnishingMinMax3;
    vec2 g_vSubstrateBurnishingMinMax3;
    float g_fGrimeUvScale3;
    float g_fGrimeTranslucency3;
    float g_fGrimeRoughnessBrightness3;
    vec2 g_vSurfaceGrimeMinMax3;
    vec2 g_vSubstrateGrimeMinMax3;
    float g_fBurnishingGrime3;
    mat4 g_mSurfaceColorAdjust4;
    mat4 g_mSubstrateColorAdjust4;
    float g_fSubstrateCompositeColorTranslucency4;
    float g_fDamageUvScale4;
    float g_fDamageHeightBlendSoftness4;
    vec2 g_vDamageMinMax4;
    int g_bDamageBevelUseTintMask4;
    mat4 g_mDamageColorAdjust4;
    float g_fDamageBevelBlendSoftness4;
    float g_fDamageBevelEmboss4;
    float g_fDamageBevelRoughnessBrightness4;
    float g_fDamageBevelAnisotropy4;
    float g_fDamageBevelMetalness4;
    float g_fDamageBevelCloth4;
    int g_bDamageBevelBlendToSubstrate4;
    float g_fBurnishingMetalness4;
    float g_fBurnishingCloth4;
    mat4 g_mSurfaceBurnishingColorAdjust4;
    mat4 g_mSubstrateBurnishingColorAdjust4;
    float g_fBurnishingNormalScale4;
    float g_fSurfaceBurnishingRoughnessBrightness4;
    float g_fSubstrateBurnishingRoughnessBrightness4;
    vec2 g_vSurfaceBurnishingMinMax4;
    vec2 g_vSubstrateBurnishingMinMax4;
    float g_fGrimeUvScale4;
    float g_fGrimeTranslucency4;
    float g_fGrimeRoughnessBrightness4;
    vec2 g_vSurfaceGrimeMinMax4;
    vec2 g_vSubstrateGrimeMinMax4;
    float g_fBurnishingGrime4;
    vec4 g_vId1Color;
    vec4 g_vId2Color;
    vec4 g_vId3Color;
    vec4 g_vId4Color;
    vec4 g_vId5Color;
    vec4 g_vId6Color;
    vec4 g_vId7Color;
    vec4 g_vId8Color;
    int g_bPatternPaintLayer;
    int g_bPatternPaintEmboss;
    float g_fPatternTranslucencyThreshold;
    int g_fPatternPaintRespectsTintMask;
    float g_fPatternCloth;
    float g_fPatternEmboss;
    float g_fPuffyPaintNormalSoftness;
    vec2 g_vPatternRoughnessContrastBrightness;
    float g_fSubstratePatternMipBias;
    int g_bId1Pattern;
    int g_bId2Pattern;
    int g_bId3Pattern;
    int g_bId4Pattern;
    int g_bId5Pattern;
    int g_bId6Pattern;
    int g_bId7Pattern;
    int g_bId8Pattern;
    float g_fWearProgress;
};

layout(set = 1) uniform _1082 _Globals_;

layout(set = 1, binding = 64) uniform texture2D g_tLayerId;
layout(set = 1, binding = 17) uniform sampler g_sTrilinearWrap;
layout(set = 1, binding = 65) uniform texture2D g_tTintId;
layout(set = 1, binding = 14) uniform sampler g_sPoint;
layout(set = 1, binding = 31) uniform texture2D g_tSurfaceNormal1;
layout(set = 1, binding = 34) uniform texture2D g_tSubstrateNormal1;
layout(set = 1, binding = 39) uniform texture2D g_tSurfaceNormal2;
layout(set = 1, binding = 42) uniform texture2D g_tSubstrateNormal2;
layout(set = 1, binding = 47) uniform texture2D g_tSurfaceNormal3;
layout(set = 1, binding = 50) uniform texture2D g_tSubstrateNormal3;
layout(set = 1, binding = 55) uniform texture2D g_tSurfaceNormal4;
layout(set = 1, binding = 58) uniform texture2D g_tSubstrateNormal4;
layout(set = 1, binding = 66) uniform texture2D g_tPattern;
layout(set = 1, binding = 67) uniform texture2D g_tPatternProperties;
layout(set = 1, binding = 30) uniform texture2D g_tSurface1;
layout(set = 1, binding = 32) uniform texture2D g_tSurfaceProperties1;
layout(set = 1, binding = 33) uniform texture2D g_tSubstrate1;
layout(set = 1, binding = 35) uniform texture2D g_tSubstrateProperties1;
layout(set = 1, binding = 36) uniform texture2D g_tDamage1;
layout(set = 1, binding = 37) uniform texture2D g_tGrime1;
layout(set = 1, binding = 38) uniform texture2D g_tSurface2;
layout(set = 1, binding = 40) uniform texture2D g_tSurfaceProperties2;
layout(set = 1, binding = 41) uniform texture2D g_tSubstrate2;
layout(set = 1, binding = 43) uniform texture2D g_tSubstrateProperties2;
layout(set = 1, binding = 44) uniform texture2D g_tDamage2;
layout(set = 1, binding = 45) uniform texture2D g_tGrime2;
layout(set = 1, binding = 46) uniform texture2D g_tSurface3;
layout(set = 1, binding = 48) uniform texture2D g_tSurfaceProperties3;
layout(set = 1, binding = 49) uniform texture2D g_tSubstrate3;
layout(set = 1, binding = 51) uniform texture2D g_tSubstrateProperties3;
layout(set = 1, binding = 52) uniform texture2D g_tDamage3;
layout(set = 1, binding = 53) uniform texture2D g_tGrime3;
layout(set = 1, binding = 54) uniform texture2D g_tSurface4;
layout(set = 1, binding = 56) uniform texture2D g_tSurfaceProperties4;
layout(set = 1, binding = 57) uniform texture2D g_tSubstrate4;
layout(set = 1, binding = 59) uniform texture2D g_tSubstrateProperties4;
layout(set = 1, binding = 60) uniform texture2D g_tDamage4;
layout(set = 1, binding = 61) uniform texture2D g_tGrime4;
layout(set = 1, binding = 63) uniform texture2D g_tObjectProperties;
layout(set = 1, binding = 15) uniform sampler g_sAniso;
layout(set = 1, binding = 62) uniform texture2D g_tNormal;

layout(location = 0) in vec4 input_0;
layout(location = 1) in vec4 input_1;
layout(location = 2) in vec4 input_2;
layout(location = 3) in vec4 input_3;
layout(location = 4) in vec4 input_4;
layout(location = 5) in vec3 input_5;
layout(location = 6) in vec4 input_6;
layout(location = 0) out vec4 output_0;

void main()
{
    vec3 _7244 = vec3(input_0.x, 1.0 - input_0.y, 1.0);
    vec3 _20527 = cross(input_5.xyz, input_6.xyz) * ((input_6.w > 0.0) ? 1.0 : (-1.0));
    float _5271[8] = float[](0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    float _23436 = dFdx(input_0.x);
    float _19160 = dFdy(input_0.y);
    float _5625 = 0.00048828125 / max(_23436, _19160);
    vec4 _19372 = texture(sampler2D(g_tLayerId, g_sTrilinearWrap), input_0.xy);
    float _15088 = _19372.x;
    float _12846 = (_19372.z + _19372.y) + _15088;
    float _12687 = max(0.0, 1.0 - _12846);
    vec4 _19317 = vec4(_15088, _19372.yz, _12687) / vec4(_12846 + _12687);
    float _20506[8] = float[](float(_Globals_.g_bId1Pattern != 0), float(_Globals_.g_bId2Pattern != 0), float(_Globals_.g_bId3Pattern != 0), float(_Globals_.g_bId4Pattern != 0), float(_Globals_.g_bId5Pattern != 0), float(_Globals_.g_bId6Pattern != 0), float(_Globals_.g_bId7Pattern != 0), float(_Globals_.g_bId8Pattern != 0));
    uvec2 _7702 = uvec2(textureSize(g_tTintId, 0));
    vec2 _25155 = vec2(1.0) / vec2(float(_7702.x), float(_7702.y));
    int _21567;
    int _23854[8][9];
    int _13039 = 0;
    for (;;)
    {
        if (!(_13039 < 9))
        {
            break;
        }
        vec4 _20360 = texture(sampler2D(g_tTintId, g_sPoint), (input_0.xy + (_1555[_13039].xy * _25155)).xy);
        int _21142 = int(ceil(_20360.x * 7.0));
        int _17040;
        int _13040 = 0;
        for (;;)
        {
            if (!(_13040 < 8))
            {
                break;
            }
            _23854[_13040][_13039] = int(_13040 == _21142);
            _17040 = _13040 + 1;
            _13040 = _17040;
            continue;
        }
        _21567 = _13039 + 1;
        _13039 = _21567;
        continue;
    }
    float _13155;
    _13155 = 0.0;
    float _13616;
    int _14722;
    int _16208 = 0;
    for (;;)
    {
        if (!(_16208 < 8))
        {
            break;
        }
        bool _12885;
        if (_23854[_16208][4] == _23854[_16208][1])
        {
            _12885 = _23854[_16208][4] == _23854[_16208][7];
        }
        else
        {
            _12885 = false;
        }
        float _21728;
        if (_12885)
        {
            _21728 = float(_23854[_16208][4]);
        }
        else
        {
            bool _12886;
            if (_23854[_16208][4] == _23854[_16208][3])
            {
                _12886 = _23854[_16208][4] == _23854[_16208][5];
            }
            else
            {
                _12886 = false;
            }
            float _12501;
            if (_12886)
            {
                _12501 = float(_23854[_16208][4]);
            }
            else
            {
                _12501 = ((0.03125 * float(((_23854[_16208][0] + _23854[_16208][2]) + _23854[_16208][6]) + _23854[_16208][8])) + (0.09375 * float(((_23854[_16208][2] + _23854[_16208][3]) + _23854[_16208][5]) + _23854[_16208][7]))) + (0.5 * float(_23854[_16208][4]));
            }
            _21728 = _12501;
        }
        _5271[_16208] = _21728;
        _13616 = _13155 + (_20506[_16208] * _21728);
        _14722 = _16208 + 1;
        _13155 = _13616;
        _16208 = _14722;
        continue;
    }
    float _7021 = dFdxFine(input_2.x);
    float _14684 = dFdxFine(input_2.y);
    vec2 _7272 = vec2(_7021, _14684);
    float _19730 = dFdyFine(input_2.x);
    float _11417 = dFdyFine(input_2.y);
    vec2 _24870 = vec2(_19730, _11417);
    float _12659 = dFdxFine(input_2.z);
    float _14685 = dFdxFine(input_2.w);
    vec2 _7273 = vec2(_12659, _14685);
    float _19731 = dFdyFine(input_2.z);
    float _11418 = dFdyFine(input_2.w);
    vec2 _24871 = vec2(_19731, _11418);
    float _12660 = dFdxFine(input_3.x);
    float _14686 = dFdxFine(input_3.y);
    vec2 _7274 = vec2(_12660, _14686);
    float _19732 = dFdyFine(input_3.x);
    float _11419 = dFdyFine(input_3.y);
    vec2 _24872 = vec2(_19732, _11419);
    float _12661 = dFdxFine(input_3.z);
    float _14687 = dFdxFine(input_3.w);
    vec2 _7275 = vec2(_12661, _14687);
    float _19733 = dFdyFine(input_3.z);
    float _11420 = dFdyFine(input_3.w);
    vec2 _24414 = vec2(_19733, _11420);
    float _9306 = _19317.x;
    bool _9694 = _9306 > 0.0;
    vec4 _6223;
    vec2 _13136;
    vec4 _13189;
    if (_9694)
    {
        _13136 = textureGrad(sampler2D(g_tSurfaceNormal1, g_sTrilinearWrap), input_2.xy, (_7272 * _Globals_.g_fPuffyPaintNormalSoftness).xy, (_24870 * _Globals_.g_fPuffyPaintNormalSoftness).xy).wy * _9306;
        _13189 = textureGrad(sampler2D(g_tSubstrateNormal1, g_sTrilinearWrap), input_2.xy, _7272, _24870).xyzw * _9306;
        _6223 = textureGrad(sampler2D(g_tSurfaceNormal1, g_sTrilinearWrap), input_2.xy, _7272, _24870).xyzw * _9306;
    }
    else
    {
        _13136 = vec2(0.0);
        _13189 = vec4(0.0);
        _6223 = vec4(0.0);
    }
    float _23427 = _19317.y;
    bool _17155 = _23427 > 0.0;
    vec4 _6224;
    vec2 _13137;
    vec4 _13190;
    if (_17155)
    {
        _13137 = _13136.xy + (textureGrad(sampler2D(g_tSurfaceNormal2, g_sTrilinearWrap), input_2.zw, (_7273 * _Globals_.g_fPuffyPaintNormalSoftness).xy, (_24871 * _Globals_.g_fPuffyPaintNormalSoftness).xy).wy * _23427);
        _13190 = _13189.xyzw + (textureGrad(sampler2D(g_tSubstrateNormal2, g_sTrilinearWrap), input_2.zw, _7273, _24871).xyzw * _23427);
        _6224 = _6223.xyzw + (textureGrad(sampler2D(g_tSurfaceNormal2, g_sTrilinearWrap), input_2.zw, _7273, _24871).xyzw * _23427);
    }
    else
    {
        _13137 = _13136;
        _13190 = _13189;
        _6224 = _6223;
    }
    float _23428 = _19317.z;
    bool _17156 = _23428 > 0.0;
    vec4 _6225;
    vec2 _13138;
    vec4 _13191;
    if (_17156)
    {
        _13138 = _13137.xy + (textureGrad(sampler2D(g_tSurfaceNormal3, g_sTrilinearWrap), input_3.xy, (_7274 * _Globals_.g_fPuffyPaintNormalSoftness).xy, (_24872 * _Globals_.g_fPuffyPaintNormalSoftness).xy).wy * _23428);
        _13191 = _13190.xyzw + (textureGrad(sampler2D(g_tSubstrateNormal3, g_sTrilinearWrap), input_3.xy, _7274, _24872).xyzw * _23428);
        _6225 = _6224.xyzw + (textureGrad(sampler2D(g_tSurfaceNormal3, g_sTrilinearWrap), input_3.xy, _7274, _24872).xyzw * _23428);
    }
    else
    {
        _13138 = _13137;
        _13191 = _13190;
        _6225 = _6224;
    }
    float _23429 = _19317.w;
    bool _17157 = _23429 > 0.0;
    vec2 _13139;
    vec4 _13192;
    vec4 _23299;
    if (_17157)
    {
        _13139 = _13138.xy + (textureGrad(sampler2D(g_tSurfaceNormal4, g_sTrilinearWrap), input_3.zw, (_7275 * _Globals_.g_fPuffyPaintNormalSoftness).xy, (_24414 * _Globals_.g_fPuffyPaintNormalSoftness).xy).wy * _23429);
        _13192 = _13191.xyzw + (textureGrad(sampler2D(g_tSubstrateNormal4, g_sTrilinearWrap), input_3.zw, _7275, _24414).xyzw * _23429);
        _23299 = _6225.xyzw + (textureGrad(sampler2D(g_tSurfaceNormal4, g_sTrilinearWrap), input_3.zw, _7275, _24414).xyzw * _23429);
    }
    else
    {
        _13139 = _13138;
        _13192 = _13191;
        _23299 = _6225;
    }
    vec2 _23430;
    float _16783 = (_23299.w + _23299.y) - 1.00392162799835205078125;
    float _11176 = _23299.w - _23299.y;
    vec3 _14854 = normalize(vec3(vec2(_16783, _11176), (1.0 - abs(_16783)) - abs(_11176)));
    float _16784 = (_13192.w + _13192.y) - 1.00392162799835205078125;
    float _11177 = _13192.w - _13192.y;
    float _16785 = (_13139.x + _13139.y) - 1.00392162799835205078125;
    float _11178 = _13139.x - _13139.y;
    vec3 _13150;
    float _13998;
    vec3 _16322;
    float _17340;
    float _17342;
    float _17343;
    float _17344;
    vec3 _17345;
    vec2 _17346;
    vec2 _17347;
    vec2 _17354;
    vec3 _17355;
    vec3 _17356;
    float _17357;
    float _17358;
    float _17359;
    float _17360;
    vec2 _17361;
    vec2 _17362;
    vec3 _17363;
    vec3 _17364;
    float _17365;
    float _17366;
    vec2 _17367;
    vec4 _17368;
    vec2 _17369;
    float _17370;
    float _17371;
    float _17372;
    float _17373;
    float _17374;
    float _17375;
    float _17378;
    float _17379;
    float _17380;
    float _17381;
    float _23300;
    do
    {
        vec2 _25090 = (input_1.xy - (input_1.zw * _14854.xy)).xy;
        vec4 _22452 = texture(sampler2D(g_tPattern, g_sTrilinearWrap), _25090);
        vec4 _20706 = texture(sampler2D(g_tPatternProperties, g_sTrilinearWrap), _25090);
        _23430 = normalize(vec3(vec2(_16784, _11177), (1.0 - abs(_16784)) - abs(_11177))).xy;
        vec4 _19373 = texture(sampler2D(g_tPattern, g_sTrilinearWrap), (input_1.xy - (input_1.zw * _23430)).xy, _Globals_.g_fSubstratePatternMipBias);
        float _24623 = _22452.w;
        bool _14874 = _Globals_.g_bPatternPaintEmboss != 0;
        float _9716;
        vec4 _24878;
        if (_14874)
        {
            vec4 _9250 = _22452;
            _9250.w = smoothstep(_Globals_.g_fPatternTranslucencyThreshold, _Globals_.g_fPatternTranslucencyThreshold + 0.039999999105930328369140625, _24623);
            _9716 = saturate((_24623 * (1.0 + _Globals_.g_fPatternTranslucencyThreshold)) - _Globals_.g_fPatternTranslucencyThreshold);
            _24878 = _9250;
        }
        else
        {
            _9716 = _24623;
            _24878 = _22452;
        }
        vec4 _9863 = (((((((vec4(_Globals_.g_vId1Color.xyz * _Globals_.g_vId1Color.w, _Globals_.g_vId1Color.w) * _5271[0]).xyzw + (vec4(_Globals_.g_vId2Color.xyz * _Globals_.g_vId2Color.w, _Globals_.g_vId2Color.w) * _5271[1])).xyzw + (vec4(_Globals_.g_vId3Color.xyz * _Globals_.g_vId3Color.w, _Globals_.g_vId3Color.w) * _5271[2])).xyzw + (vec4(_Globals_.g_vId4Color.xyz * _Globals_.g_vId4Color.w, _Globals_.g_vId4Color.w) * _5271[3])).xyzw + (vec4(_Globals_.g_vId5Color.xyz * _Globals_.g_vId5Color.w, _Globals_.g_vId5Color.w) * _5271[4])).xyzw + (vec4(_Globals_.g_vId6Color.xyz * _Globals_.g_vId6Color.w, _Globals_.g_vId6Color.w) * _5271[5])).xyzw + (vec4(_Globals_.g_vId7Color.xyz * _Globals_.g_vId7Color.w, _Globals_.g_vId7Color.w) * _5271[6])).xyzw;
        vec4 _23647 = _9863 + (vec4(_Globals_.g_vId8Color.xyz * _Globals_.g_vId8Color.w, _Globals_.g_vId8Color.w) * _5271[7]);
        float _14212 = _23647.w;
        vec4 _21709;
        if (_14212 > 0.0)
        {
            vec3 _8908 = _23647.xyz / vec3(_14212);
            vec4 _22905 = _23647;
            _22905.x = _8908.x;
            _22905.y = _8908.y;
            _22905.z = _8908.z;
            _21709 = _22905;
        }
        else
        {
            vec4 _11077 = _23647;
            _11077.x = 1.0;
            _11077.y = 1.0;
            _11077.z = 1.0;
            _21709 = _11077;
        }
        bool _14875 = _Globals_.g_bPattern != 0;
        bool _12889;
        if (_14875)
        {
            _12889 = _Globals_.g_bPatternPaintLayer == 0;
        }
        else
        {
            _12889 = false;
        }
        float _6536;
        vec3 _7079;
        float _8530;
        float _8568;
        vec2 _9596;
        vec3 _11467;
        vec3 _12902;
        float _13560;
        bool _14876;
        float _16297;
        float _16973;
        vec3 _19312;
        vec3 _19313;
        float _22892;
        float _23574;
        vec3 _23992;
        vec2 _13143;
        vec2 _16308;
        vec2 _17193;
        vec2 _17194;
        float _17195;
        vec4 _17196;
        vec2 _17197;
        float _17198;
        float _17199;
        float _17200;
        float _17201;
        float _17202;
        float _17203;
        float _17204;
        float _17205;
        float _17206;
        float _17207;
        float _17208;
        float _17209;
        float _17212;
        float _21710;
        SPIRV_CROSS_BRANCH
        if (_12889)
        {
            float _10541 = float(_21709.w == 0.0);
            float _18695 = _19373.w;
            float _14946 = _13155 * _24878.w;
            float _19629;
            if (_21709.w > 0.0)
            {
                _19629 = saturate(_24878.w / _21709.w);
            }
            else
            {
                _19629 = _10541;
            }
            vec3 _19714 = mix(_21709.xyz, _19373.xyz, vec3(max(_10541, _18695) * _14946));
            float _14750 = max(_21709.w, _18695 * _14946);
            vec4 _12736 = vec4(_19714, _14750);
            vec3 _19715 = mix(_21709.xyz, _24878.xyz, vec3(_19629 * _14946));
            float _14615 = max(_21709.w, _24878.w * _14946);
            float _22280 = _19715.x;
            float _17341 = _19715.y;
            float _24875 = _19715.z;
            vec4 _10562 = vec4(_22280, _17341, _24875, _14615);
            float _7259 = dFdxFine(input_2.x);
            float _18737 = dFdxFine(input_2.y);
            float _12361 = dFdyFine(input_2.x);
            float _12285 = dFdyFine(input_2.y);
            float _18075 = dFdxFine(input_2.z);
            float _24608 = dFdxFine(input_2.w);
            float _12371 = dFdyFine(input_2.z);
            float _12286 = dFdyFine(input_2.w);
            float _18076 = dFdxFine(input_3.x);
            float _24609 = dFdxFine(input_3.y);
            float _12372 = dFdyFine(input_3.x);
            float _12287 = dFdyFine(input_3.y);
            float _18077 = dFdxFine(input_3.z);
            float _24610 = dFdxFine(input_3.w);
            float _9870 = dFdyFine(input_3.z);
            float _13125 = dFdyFine(input_3.w);
            vec2 _13407 = input_4.xy * _Globals_.g_fDamageUvScale1;
            vec2 _13408 = input_4.xy * _Globals_.g_fDamageUvScale2;
            vec2 _13409 = input_4.xy * _Globals_.g_fDamageUvScale3;
            vec2 _13437 = input_4.xy * _Globals_.g_fDamageUvScale4;
            float _12000 = _13407.x;
            float _23922 = dFdxFine(_12000);
            float _18331 = _13407.y;
            float _11100 = dFdxFine(_18331);
            float _12115 = dFdyFine(_12000);
            float _15534 = dFdyFine(_18331);
            float _10986 = _13408.x;
            float _12078 = dFdxFine(_10986);
            float _18332 = _13408.y;
            float _11101 = dFdxFine(_18332);
            float _12116 = dFdyFine(_10986);
            float _15535 = dFdyFine(_18332);
            float _10987 = _13409.x;
            float _12079 = dFdxFine(_10987);
            float _18333 = _13409.y;
            float _11102 = dFdxFine(_18333);
            float _12117 = dFdyFine(_10987);
            float _15536 = dFdyFine(_18333);
            float _10988 = _13437.x;
            float _12080 = dFdxFine(_10988);
            float _18334 = _13437.y;
            float _11103 = dFdxFine(_18334);
            float _12081 = dFdyFine(_10988);
            float _13126 = dFdyFine(_18334);
            vec2 _13410 = input_4.zw * _Globals_.g_fGrimeUvScale1;
            vec2 _13411 = input_4.zw * _Globals_.g_fGrimeUvScale2;
            vec2 _13412 = input_4.zw * _Globals_.g_fGrimeUvScale3;
            vec2 _13438 = input_4.zw * _Globals_.g_fGrimeUvScale4;
            float _12001 = _13410.x;
            float _23923 = dFdxFine(_12001);
            float _18335 = _13410.y;
            float _11104 = dFdxFine(_18335);
            float _12118 = dFdyFine(_12001);
            float _15537 = dFdyFine(_18335);
            float _10989 = _13411.x;
            float _12082 = dFdxFine(_10989);
            float _18339 = _13411.y;
            float _11105 = dFdxFine(_18339);
            float _12119 = dFdyFine(_10989);
            float _15538 = dFdyFine(_18339);
            float _10990 = _13412.x;
            float _12083 = dFdxFine(_10990);
            float _18340 = _13412.y;
            float _11106 = dFdxFine(_18340);
            float _12120 = dFdyFine(_10990);
            float _15539 = dFdyFine(_18340);
            float _10991 = _13438.x;
            float _12084 = dFdxFine(_10991);
            float _18344 = _13438.y;
            float _11107 = dFdxFine(_18344);
            float _15264 = dFdyFine(_10991);
            float _6642 = dFdyFine(_18344);
            float _13144;
            float _16310;
            vec2 _16866;
            float _17218;
            bool _17219;
            float _17220;
            float _17221;
            float _17222;
            float _17225;
            float _17226;
            float _17227;
            float _17228;
            float _17229;
            float _17230;
            float _17231;
            float _17232;
            float _17233;
            vec2 _17234;
            vec2 _17235;
            vec2 _17236;
            vec2 _17237;
            float _17238;
            vec4 _17239;
            float _17240;
            vec4 _17241;
            vec4 _17246;
            vec4 _17247;
            vec4 _17248;
            if (_9694)
            {
                vec2 _6262 = vec2(_7259, _18737);
                vec2 _19545 = vec2(_12361, _12285);
                _13144 = _Globals_.g_fBurnishingNormalScale1 * _9306;
                _16310 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness1 * _9306;
                _17218 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness1 * _9306;
                _17219 = _Globals_.g_bDamageBevelUseTintMask1 != 0;
                _17220 = _Globals_.g_fDamageBevelEmboss1 * _9306;
                _17221 = _Globals_.g_fDamageHeightBlendSoftness1 * _9306;
                _17222 = _Globals_.g_fDamageBevelBlendSoftness1 * _9306;
                _17225 = _Globals_.g_fBurnishingGrime1 * _9306;
                _17226 = _Globals_.g_fGrimeRoughnessBrightness1 * _9306;
                _17227 = _Globals_.g_fBurnishingCloth1 * _9306;
                _17228 = _Globals_.g_fBurnishingMetalness1 * _9306;
                _17229 = float(_Globals_.g_bDamageBevelBlendToSubstrate1 != 0) * _9306;
                _17230 = _Globals_.g_fDamageBevelCloth1 * _9306;
                _17231 = _Globals_.g_fDamageBevelMetalness1 * _9306;
                _17232 = _Globals_.g_fDamageBevelAnisotropy1 * _9306;
                _17233 = _Globals_.g_fDamageBevelRoughnessBrightness1 * _9306;
                _17234 = _Globals_.g_vSubstrateGrimeMinMax1 * _9306;
                _17235 = _Globals_.g_vSurfaceGrimeMinMax1 * _9306;
                _17236 = _Globals_.g_vSubstrateBurnishingMinMax1 * _9306;
                _17237 = _Globals_.g_vSurfaceBurnishingMinMax1 * _9306;
                _17238 = _Globals_.g_fSubstrateCompositeColorTranslucency1 * _9306;
                _17239 = vec4(textureGrad(sampler2D(g_tGrime1, g_sTrilinearWrap), _13410.xy, vec2(_23923, _11104), vec2(_12118, _15537)).xyz * _9306, _Globals_.g_fGrimeTranslucency1 * _9306);
                _17240 = textureGrad(sampler2D(g_tDamage1, g_sTrilinearWrap), _13407.xy, vec2(_23922, _11100), vec2(_12115, _15534)).x * _9306;
                _17241 = textureGrad(sampler2D(g_tSubstrateProperties1, g_sTrilinearWrap), input_2.xy, _6262, _19545).xyzw * _9306;
                _17246 = textureGrad(sampler2D(g_tSubstrate1, g_sTrilinearWrap), input_2.xy, _6262, _19545).xyzw * _9306;
                _17247 = textureGrad(sampler2D(g_tSurfaceProperties1, g_sTrilinearWrap), input_2.xy, _6262, _19545).xyzw * _9306;
                _17248 = textureGrad(sampler2D(g_tSurface1, g_sTrilinearWrap), input_2.xy, _6262, _19545).xyzw * _9306;
                _16866 = _Globals_.g_vDamageMinMax1 * _9306;
            }
            else
            {
                _13144 = 0.0;
                _16310 = 0.0;
                _17218 = 0.0;
                _17219 = false;
                _17220 = 0.0;
                _17221 = 0.0;
                _17222 = 0.0;
                _17225 = 0.0;
                _17226 = 0.0;
                _17227 = 0.0;
                _17228 = 0.0;
                _17229 = 0.0;
                _17230 = 0.0;
                _17231 = 0.0;
                _17232 = 0.0;
                _17233 = 0.0;
                _17234 = vec2(0.0);
                _17235 = vec2(0.0);
                _17236 = vec2(0.0);
                _17237 = vec2(0.0);
                _17238 = 0.0;
                _17239 = vec4(0.0);
                _17240 = 0.0;
                _17241 = vec4(0.0);
                _17246 = vec4(0.0);
                _17247 = vec4(0.0);
                _17248 = vec4(0.0);
                _16866 = vec2(0.0);
            }
            float _13145;
            float _16311;
            vec2 _16867;
            float _17249;
            bool _17250;
            float _17251;
            float _17252;
            float _17253;
            float _17257;
            float _17258;
            float _17259;
            float _17260;
            float _17261;
            float _17262;
            float _17263;
            float _17264;
            float _17265;
            vec2 _17266;
            vec2 _17267;
            vec2 _17268;
            vec2 _17270;
            float _17271;
            vec4 _17272;
            float _17273;
            vec4 _17274;
            vec4 _17275;
            vec4 _17276;
            vec4 _17277;
            if (_17155)
            {
                vec2 _16498 = vec2(_18075, _24608);
                vec2 _19548 = vec2(_12371, _12286);
                _13145 = _Globals_.g_fBurnishingNormalScale2 * _23427;
                _16311 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness2 * _23427;
                _17249 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness2 * _23427;
                _17250 = _Globals_.g_bDamageBevelUseTintMask2 != 0;
                _17251 = _17220 + (_Globals_.g_fDamageBevelEmboss2 * _23427);
                _17252 = _17221 + (_Globals_.g_fDamageHeightBlendSoftness2 * _23427);
                _17253 = _17222 + (_Globals_.g_fDamageBevelBlendSoftness2 * _23427);
                _17257 = _17225 + (_Globals_.g_fBurnishingGrime2 * _23427);
                _17258 = _17226 + (_Globals_.g_fGrimeRoughnessBrightness2 * _23427);
                _17259 = _17227 + (_Globals_.g_fBurnishingCloth2 * _23427);
                _17260 = _17228 + (_Globals_.g_fBurnishingMetalness2 * _23427);
                _17261 = _17229 + (float(_Globals_.g_bDamageBevelBlendToSubstrate2 != 0) * _23427);
                _17262 = _17230 + (_Globals_.g_fDamageBevelCloth2 * _23427);
                _17263 = _17231 + (_Globals_.g_fDamageBevelMetalness2 * _23427);
                _17264 = _17232 + (_Globals_.g_fDamageBevelAnisotropy2 * _23427);
                _17265 = _17233 + (_Globals_.g_fDamageBevelRoughnessBrightness2 * _23427);
                _17266 = _17234 + (_Globals_.g_vSubstrateGrimeMinMax2 * _23427);
                _17267 = _17235 + (_Globals_.g_vSurfaceGrimeMinMax2 * _23427);
                _17268 = _17236 + (_Globals_.g_vSubstrateBurnishingMinMax2 * _23427);
                _17270 = _17237 + (_Globals_.g_vSurfaceBurnishingMinMax2 * _23427);
                _17271 = _17238 + (_Globals_.g_fSubstrateCompositeColorTranslucency2 * _23427);
                _17272 = vec4(_17239.xyz + (textureGrad(sampler2D(g_tGrime2, g_sTrilinearWrap), _13411.xy, vec2(_12082, _11105), vec2(_12119, _15538)).xyz * _23427), _17239.w + (_Globals_.g_fGrimeTranslucency2 * _23427));
                _17273 = _17240 + (textureGrad(sampler2D(g_tDamage2, g_sTrilinearWrap), _13408.xy, vec2(_12078, _11101), vec2(_12116, _15535)).x * _23427);
                _17274 = _17241.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties2, g_sTrilinearWrap), input_2.zw, _16498, _19548).xyzw * _23427);
                _17275 = _17246.xyzw + (textureGrad(sampler2D(g_tSubstrate2, g_sTrilinearWrap), input_2.zw, _16498, _19548).xyzw * _23427);
                _17276 = _17247.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties2, g_sTrilinearWrap), input_2.zw, _16498, _19548).xyzw * _23427);
                _17277 = _17248.xyzw + (textureGrad(sampler2D(g_tSurface2, g_sTrilinearWrap), input_2.zw, _16498, _19548).xyzw * _23427);
                _16867 = _16866 + (_Globals_.g_vDamageMinMax2 * _23427);
            }
            else
            {
                _13145 = _13144;
                _16311 = _16310;
                _17249 = _17218;
                _17250 = _17219;
                _17251 = _17220;
                _17252 = _17221;
                _17253 = _17222;
                _17257 = _17225;
                _17258 = _17226;
                _17259 = _17227;
                _17260 = _17228;
                _17261 = _17229;
                _17262 = _17230;
                _17263 = _17231;
                _17264 = _17232;
                _17265 = _17233;
                _17266 = _17234;
                _17267 = _17235;
                _17268 = _17236;
                _17270 = _17237;
                _17271 = _17238;
                _17272 = _17239;
                _17273 = _17240;
                _17274 = _17241;
                _17275 = _17246;
                _17276 = _17247;
                _17277 = _17248;
                _16867 = _16866;
            }
            float _13146;
            float _16312;
            vec2 _16868;
            float _17278;
            bool _17279;
            float _17280;
            float _17281;
            float _17282;
            float _17285;
            float _17286;
            float _17287;
            float _17288;
            float _17289;
            float _17290;
            float _17291;
            float _17292;
            float _17293;
            vec2 _17294;
            vec2 _17295;
            vec2 _17296;
            vec2 _17297;
            float _17298;
            vec4 _17299;
            float _17300;
            vec4 _17301;
            vec4 _17302;
            vec4 _17303;
            vec4 _17304;
            if (_17156)
            {
                vec2 _16500 = vec2(_18076, _24609);
                vec2 _19552 = vec2(_12372, _12287);
                _13146 = _Globals_.g_fBurnishingNormalScale3 * _23428;
                _16312 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness3 * _23428;
                _17278 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness3 * _23428;
                _17279 = _Globals_.g_bDamageBevelUseTintMask3 != 0;
                _17280 = _17251 + (_Globals_.g_fDamageBevelEmboss3 * _23428);
                _17281 = _17252 + (_Globals_.g_fDamageHeightBlendSoftness3 * _23428);
                _17282 = _17253 + (_Globals_.g_fDamageBevelBlendSoftness3 * _23428);
                _17285 = _17257 + (_Globals_.g_fBurnishingGrime3 * _23428);
                _17286 = _17258 + (_Globals_.g_fGrimeRoughnessBrightness3 * _23428);
                _17287 = _17259 + (_Globals_.g_fBurnishingCloth3 * _23428);
                _17288 = _17260 + (_Globals_.g_fBurnishingMetalness3 * _23428);
                _17289 = _17261 + (float(_Globals_.g_bDamageBevelBlendToSubstrate3 != 0) * _23428);
                _17290 = _17262 + (_Globals_.g_fDamageBevelCloth3 * _23428);
                _17291 = _17263 + (_Globals_.g_fDamageBevelMetalness3 * _23428);
                _17292 = _17264 + (_Globals_.g_fDamageBevelAnisotropy3 * _23428);
                _17293 = _17265 + (_Globals_.g_fDamageBevelRoughnessBrightness3 * _23428);
                _17294 = _17266 + (_Globals_.g_vSubstrateGrimeMinMax3 * _23428);
                _17295 = _17267 + (_Globals_.g_vSurfaceGrimeMinMax3 * _23428);
                _17296 = _17268 + (_Globals_.g_vSubstrateBurnishingMinMax3 * _23428);
                _17297 = _17270 + (_Globals_.g_vSurfaceBurnishingMinMax3 * _23428);
                _17298 = _17271 + (_Globals_.g_fSubstrateCompositeColorTranslucency3 * _23428);
                _17299 = vec4(_17272.xyz + (textureGrad(sampler2D(g_tGrime3, g_sTrilinearWrap), _13412.xy, vec2(_12083, _11106), vec2(_12120, _15539)).xyz * _23428), _17272.w + (_Globals_.g_fGrimeTranslucency3 * _23428));
                _17300 = _17273 + (textureGrad(sampler2D(g_tDamage3, g_sTrilinearWrap), _13409.xy, vec2(_12079, _11102), vec2(_12117, _15536)).x * _23428);
                _17301 = _17274.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties3, g_sTrilinearWrap), input_3.xy, _16500, _19552).xyzw * _23428);
                _17302 = _17275.xyzw + (textureGrad(sampler2D(g_tSubstrate3, g_sTrilinearWrap), input_3.xy, _16500, _19552).xyzw * _23428);
                _17303 = _17276.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties3, g_sTrilinearWrap), input_3.xy, _16500, _19552).xyzw * _23428);
                _17304 = _17277.xyzw + (textureGrad(sampler2D(g_tSurface3, g_sTrilinearWrap), input_3.xy, _16500, _19552).xyzw * _23428);
                _16868 = _16867 + (_Globals_.g_vDamageMinMax3 * _23428);
            }
            else
            {
                _13146 = _13145;
                _16312 = _16311;
                _17278 = _17249;
                _17279 = _17250;
                _17280 = _17251;
                _17281 = _17252;
                _17282 = _17253;
                _17285 = _17257;
                _17286 = _17258;
                _17287 = _17259;
                _17288 = _17260;
                _17289 = _17261;
                _17290 = _17262;
                _17291 = _17263;
                _17292 = _17264;
                _17293 = _17265;
                _17294 = _17266;
                _17295 = _17267;
                _17296 = _17268;
                _17297 = _17270;
                _17298 = _17271;
                _17299 = _17272;
                _17300 = _17273;
                _17301 = _17274;
                _17302 = _17275;
                _17303 = _17276;
                _17304 = _17277;
                _16868 = _16867;
            }
            vec4 _6617;
            vec2 _13147;
            bool _13695;
            vec2 _16313;
            vec2 _17305;
            vec2 _17306;
            float _17307;
            float _17308;
            vec4 _17309;
            vec2 _17310;
            float _17311;
            float _17312;
            float _17313;
            float _17314;
            float _17315;
            float _17316;
            float _17317;
            float _17318;
            float _17319;
            float _17320;
            float _17321;
            float _17322;
            float _17323;
            float _17324;
            float _17325;
            vec4 _17326;
            vec4 _17327;
            vec4 _17328;
            if (_17157)
            {
                vec2 _16502 = vec2(_18077, _24610);
                vec2 _19556 = vec2(_9870, _13125);
                _13147 = _17297 + (_Globals_.g_vSurfaceBurnishingMinMax4 * _23429);
                _16313 = _17295 + (_Globals_.g_vSurfaceGrimeMinMax4 * _23429);
                _17305 = _17296 + (_Globals_.g_vSubstrateBurnishingMinMax4 * _23429);
                _17306 = _17294 + (_Globals_.g_vSubstrateGrimeMinMax4 * _23429);
                _17307 = _17300 + (textureGrad(sampler2D(g_tDamage4, g_sTrilinearWrap), _13437.xy, vec2(_12080, _11103), vec2(_12081, _13126)).x * _23429);
                _17308 = _17281 + (_Globals_.g_fDamageHeightBlendSoftness4 * _23429);
                _17309 = vec4(_17299.xyz + (textureGrad(sampler2D(g_tGrime4, g_sTrilinearWrap), _13438.xy, vec2(_12084, _11107), vec2(_15264, _6642)).xyz * _23429), _17299.w + (_Globals_.g_fGrimeTranslucency4 * _23429));
                _17310 = _16868 + (_Globals_.g_vDamageMinMax4 * _23429);
                _17311 = _17286 + (_Globals_.g_fGrimeRoughnessBrightness4 * _23429);
                _17312 = _17282 + (_Globals_.g_fDamageBevelBlendSoftness4 * _23429);
                _17313 = _17290 + (_Globals_.g_fDamageBevelCloth4 * _23429);
                _17314 = _17289 + (float(_Globals_.g_bDamageBevelBlendToSubstrate4 != 0) * _23429);
                _17315 = _17288 + (_Globals_.g_fBurnishingMetalness4 * _23429);
                _17316 = _17280 + (_Globals_.g_fDamageBevelEmboss4 * _23429);
                _17317 = _17287 + (_Globals_.g_fBurnishingCloth4 * _23429);
                _17318 = _17285 + (_Globals_.g_fBurnishingGrime4 * _23429);
                _17319 = _Globals_.g_fBurnishingNormalScale4 * _23429;
                _17320 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness4 * _23429;
                _17321 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness4 * _23429;
                _17322 = _17292 + (_Globals_.g_fDamageBevelAnisotropy4 * _23429);
                _17323 = _17293 + (_Globals_.g_fDamageBevelRoughnessBrightness4 * _23429);
                _17324 = _17291 + (_Globals_.g_fDamageBevelMetalness4 * _23429);
                _17325 = _17298 + (_Globals_.g_fSubstrateCompositeColorTranslucency4 * _23429);
                _17326 = _17301.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties4, g_sTrilinearWrap), input_3.zw, _16502, _19556).xyzw * _23429);
                _17327 = _17302.xyzw + (textureGrad(sampler2D(g_tSubstrate4, g_sTrilinearWrap), input_3.zw, _16502, _19556).xyzw * _23429);
                _17328 = _17303.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties4, g_sTrilinearWrap), input_3.zw, _16502, _19556).xyzw * _23429);
                _13695 = _Globals_.g_bDamageBevelUseTintMask4 != 0;
                _6617 = _17304.xyzw + (textureGrad(sampler2D(g_tSurface4, g_sTrilinearWrap), input_3.zw, _16502, _19556).xyzw * _23429);
            }
            else
            {
                _13147 = _17297;
                _16313 = _17295;
                _17305 = _17296;
                _17306 = _17294;
                _17307 = _17300;
                _17308 = _17281;
                _17309 = _17299;
                _17310 = _16868;
                _17311 = _17286;
                _17312 = _17282;
                _17313 = _17290;
                _17314 = _17289;
                _17315 = _17288;
                _17316 = _17280;
                _17317 = _17287;
                _17318 = _17285;
                _17319 = _13146;
                _17320 = _16312;
                _17321 = _17278;
                _17322 = _17292;
                _17323 = _17293;
                _17324 = _17291;
                _17325 = _17298;
                _17326 = _17301;
                _17327 = _17302;
                _17328 = _17303;
                _13695 = _17279;
                _6617 = _17304;
            }
            bool _14877 = _Globals_.g_fPatternPaintRespectsTintMask != 0;
            float _21712;
            if (_14877)
            {
                _21712 = _6617.w;
            }
            else
            {
                _21712 = max(_6617.w, _14946);
            }
            mat4 _19938 = mat4((((_Globals_.g_mSurfaceBurnishingColorAdjust1[0] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[0] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[0] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[0] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[1] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[1] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[1] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[1] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[2] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[2] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[2] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[2] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[3] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[3] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[3] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[3] * _23429));
            vec4 _24835 = vec4(_6617.xyz, 1.0);
            vec4 _11583 = vec4((_24835 * mat4((((_Globals_.g_mSurfaceColorAdjust1[0] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[0] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[0] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[0] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[1] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[1] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[1] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[1] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[2] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[2] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[2] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[2] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[3] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[3] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[3] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18229 = _11583.xyz;
            vec3 _16614;
            do
            {
                float _21021;
                do
                {
                    float _18474 = max(_22280, max(_17341, _24875));
                    if (_18474 == 0.0)
                    {
                        _21021 = 0.0;
                        break;
                    }
                    _21021 = (_18474 - min(_22280, min(_17341, _24875))) / _18474;
                    break;
                } while(false);
                float _12837 = dot(_10562.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
                float _23054 = max(dot(_11583.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                if (_12837 > 0.0)
                {
                    vec3 _22575 = normalize(_10562.xyz).xyz - vec3(0.57700002193450927734375);
                    vec3 _7062 = saturate((normalize(_22575) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15715 = _7062 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16614 = mix((_18229 * mix(1.0, min(max(1.0 + (4.0 * (_12837 - 0.5)), mix(0.02999999932944774627685546875, 0.134000003337860107421875, _17328.y) / _23054), mix(0.89999997615814208984375, 0.980000019073486328125, _17328.y) / _23054), _14615)).xyz, _7062 * (_12837 / ((_15715.x + _15715.y) + _15715.z)), vec3(saturate(_21021 * pow(abs(dot(_22575, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _14615));
                    break;
                }
                else
                {
                    _16614 = _18229;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            vec3 _19314 = mix(_6617.xyz, _16614, vec3(_21712));
            float _21719;
            if (_14877)
            {
                _21719 = _17327.w;
            }
            else
            {
                _21719 = max(_17327.w, _14946);
            }
            bool _6222;
            vec3 _7903;
            float _9233;
            float _12838;
            bool _15232;
            float _16315;
            float _18475;
            float _6651 = _14750 * _17325;
            vec4 _24836 = vec4(_17327.xyz, 1.0);
            vec4 _11584 = vec4((_24836 * mat4((((_Globals_.g_mSubstrateColorAdjust1[0] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[0] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[0] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[0] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[1] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[1] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[1] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[1] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[2] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[2] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[2] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[2] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[3] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[3] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[3] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18230 = _11584.xyz;
            vec3 _16615;
            do
            {
                _7903 = _12736.xyz;
                float _21022;
                do
                {
                    float _17003 = _19714.x;
                    float _10965 = _19714.y;
                    float _21521 = _19714.z;
                    _18475 = max(_17003, max(_10965, _21521));
                    _16315 = _18475 - min(_17003, min(_10965, _21521));
                    _6222 = _18475 == 0.0;
                    if (_6222)
                    {
                        _21022 = 0.0;
                        break;
                    }
                    _21022 = _16315 / _18475;
                    break;
                } while(false);
                _12838 = dot(_12736.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
                float _23055 = max(dot(_11584.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                _9233 = 4.0 * (_12838 - 0.5);
                _15232 = _12838 > 0.0;
                if (_15232)
                {
                    vec3 _22576 = normalize(_7903).xyz - vec3(0.57700002193450927734375);
                    vec3 _7063 = saturate((normalize(_22576) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15716 = _7063 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16615 = mix((_18230 * mix(1.0, min(max(1.0 + _9233, mix(0.02999999932944774627685546875, 0.134000003337860107421875, _17326.y) / _23055), mix(0.89999997615814208984375, 0.980000019073486328125, _17326.y) / _23055), _6651)).xyz, _7063 * (_12838 / ((_15716.x + _15716.y) + _15716.z)), vec3(saturate(_21022 * pow(abs(dot(_22576, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _6651));
                    break;
                }
                else
                {
                    _16615 = _18230;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            vec4 _11585 = vec4((_24835 * mat4((((_Globals_.g_mDamageColorAdjust1[0] * _9306) + (_Globals_.g_mDamageColorAdjust2[0] * _23427)) + (_Globals_.g_mDamageColorAdjust3[0] * _23428)) + (_Globals_.g_mDamageColorAdjust4[0] * _23429), (((_Globals_.g_mDamageColorAdjust1[1] * _9306) + (_Globals_.g_mDamageColorAdjust2[1] * _23427)) + (_Globals_.g_mDamageColorAdjust3[1] * _23428)) + (_Globals_.g_mDamageColorAdjust4[1] * _23429), (((_Globals_.g_mDamageColorAdjust1[2] * _9306) + (_Globals_.g_mDamageColorAdjust2[2] * _23427)) + (_Globals_.g_mDamageColorAdjust3[2] * _23428)) + (_Globals_.g_mDamageColorAdjust4[2] * _23429), (((_Globals_.g_mDamageColorAdjust1[3] * _9306) + (_Globals_.g_mDamageColorAdjust2[3] * _23427)) + (_Globals_.g_mDamageColorAdjust3[3] * _23428)) + (_Globals_.g_mDamageColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18231 = _11585.xyz;
            vec3 _16616;
            do
            {
                float _21023;
                do
                {
                    if (_6222)
                    {
                        _21023 = 0.0;
                        break;
                    }
                    _21023 = _16315 / _18475;
                    break;
                } while(false);
                float _17329 = max(dot(_11585.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                if (_15232)
                {
                    vec3 _22577 = normalize(_7903).xyz - vec3(0.57700002193450927734375);
                    vec3 _7064 = saturate((normalize(_22577) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15717 = _7064 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16616 = mix((_18231 * mix(1.0, min(max(1.0 + _9233, mix(0.02999999932944774627685546875, 0.134000003337860107421875, _17324) / _17329), mix(0.89999997615814208984375, 0.980000019073486328125, _17324) / _17329), _6651)).xyz, _7064 * (_12838 / ((_15717.x + _15717.y) + _15717.z)), vec3(saturate(_21023 * pow(abs(dot(_22577, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _6651));
                    break;
                }
                else
                {
                    _16616 = _18231;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            vec3 _11468 = mix(_19314.xyz, _16616, vec3(_13695 ? _21712 : 1.0));
            vec2 _23651 = _23299.xz * _17323;
            _23651.y = mix(_23651.x, _23651.y, _17322);
            _13150 = _19314;
            _16322 = vec3((_24835 * _19938).xyz);
            _17340 = _17328.x;
            _17342 = _17328.w;
            _17343 = _17328.y;
            _17344 = _17328.z * (1.0 - _17328.y);
            _17345 = _14854;
            _17346 = mix(_23299.xz, saturate((((_23299.xz - vec2(0.5)) + vec2(_Globals_.g_vPatternRoughnessContrastBrightness.y)) * _Globals_.g_vPatternRoughnessContrastBrightness.x) + vec2(0.5)), vec2(_14946 * _21712));
            _17347 = _13147;
            _17354 = _16313;
            _17355 = mix(_17327.xyz, _16615, vec3(_21719));
            _17356 = vec3((_24836 * mat4((((_Globals_.g_mSubstrateBurnishingColorAdjust1[0] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[0] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[0] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[0] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[1] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[1] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[1] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[1] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[2] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[2] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[2] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[2] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[3] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[3] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[3] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[3] * _23429))).xyz);
            _17357 = _17326.x;
            _17358 = _17326.w;
            _17359 = _17326.z * (1.0 - _17326.y);
            _17360 = _17326.y;
            _17361 = _17305;
            _17362 = _17306;
            _17363 = _11468;
            _17364 = vec4((vec4(vec4(_11468.xyz, 1.0).xyz, 1.0) * _19938).xyz, 1.0).xyz;
            _17365 = _17307;
            _17366 = _17308;
            _17367 = _23651;
            _17368 = _17309;
            _17369 = _17310;
            _17370 = _17311;
            _17371 = _17312;
            _17372 = _17324;
            _17373 = _17313;
            _17374 = _17314;
            _17375 = _17315;
            _17378 = _17316;
            _17379 = _17317;
            _17380 = _17318;
            _17381 = _17319;
            _13998 = _17320;
            _23300 = _17321;
            break;
        }
        else
        {
            float _23270 = dFdxFine(input_2.x);
            float _6319 = dFdxFine(input_2.y);
            float _12358 = dFdyFine(input_2.x);
            float _12282 = dFdyFine(input_2.y);
            float _18072 = dFdxFine(input_2.z);
            float _24605 = dFdxFine(input_2.w);
            float _12359 = dFdyFine(input_2.z);
            float _12283 = dFdyFine(input_2.w);
            float _18073 = dFdxFine(input_3.x);
            float _24606 = dFdxFine(input_3.y);
            float _12360 = dFdyFine(input_3.x);
            float _12284 = dFdyFine(input_3.y);
            float _18074 = dFdxFine(input_3.z);
            float _24607 = dFdxFine(input_3.w);
            float _9869 = dFdyFine(input_3.z);
            float _13119 = dFdyFine(input_3.w);
            vec2 _13372 = input_4.xy * _Globals_.g_fDamageUvScale1;
            vec2 _13373 = input_4.xy * _Globals_.g_fDamageUvScale2;
            vec2 _13374 = input_4.xy * _Globals_.g_fDamageUvScale3;
            vec2 _13435 = input_4.xy * _Globals_.g_fDamageUvScale4;
            float _11998 = _13372.x;
            float _23920 = dFdxFine(_11998);
            float _18323 = _13372.y;
            float _11092 = dFdxFine(_18323);
            float _12109 = dFdyFine(_11998);
            float _15528 = dFdyFine(_18323);
            float _10980 = _13373.x;
            float _12071 = dFdxFine(_10980);
            float _18324 = _13373.y;
            float _11093 = dFdxFine(_18324);
            float _12110 = dFdyFine(_10980);
            float _15529 = dFdyFine(_18324);
            float _10981 = _13374.x;
            float _12072 = dFdxFine(_10981);
            float _18325 = _13374.y;
            float _11094 = dFdxFine(_18325);
            float _12111 = dFdyFine(_10981);
            float _15530 = dFdyFine(_18325);
            float _10982 = _13435.x;
            float _12073 = dFdxFine(_10982);
            float _18326 = _13435.y;
            float _11095 = dFdxFine(_18326);
            float _12074 = dFdyFine(_10982);
            float _13120 = dFdyFine(_18326);
            vec2 _13375 = input_4.zw * _Globals_.g_fGrimeUvScale1;
            vec2 _13376 = input_4.zw * _Globals_.g_fGrimeUvScale2;
            vec2 _13377 = input_4.zw * _Globals_.g_fGrimeUvScale3;
            vec2 _13436 = input_4.zw * _Globals_.g_fGrimeUvScale4;
            float _11999 = _13375.x;
            float _23921 = dFdxFine(_11999);
            float _18327 = _13375.y;
            float _11096 = dFdxFine(_18327);
            float _12112 = dFdyFine(_11999);
            float _15531 = dFdyFine(_18327);
            float _10983 = _13376.x;
            float _12075 = dFdxFine(_10983);
            float _18328 = _13376.y;
            float _11097 = dFdxFine(_18328);
            float _12113 = dFdyFine(_10983);
            float _15532 = dFdyFine(_18328);
            float _10984 = _13377.x;
            float _12076 = dFdxFine(_10984);
            float _18329 = _13377.y;
            float _11098 = dFdxFine(_18329);
            float _12114 = dFdyFine(_10984);
            float _15533 = dFdyFine(_18329);
            float _10985 = _13436.x;
            float _12077 = dFdxFine(_10985);
            float _18330 = _13436.y;
            float _11099 = dFdxFine(_18330);
            float _15263 = dFdyFine(_10985);
            float _6641 = dFdyFine(_18330);
            float _13140;
            float _16305;
            vec2 _16863;
            float _17114;
            bool _17115;
            float _17116;
            float _17117;
            float _17118;
            float _17119;
            float _17120;
            float _17121;
            float _17122;
            float _17123;
            float _17124;
            float _17125;
            float _17126;
            float _17127;
            vec2 _17128;
            vec2 _17129;
            vec2 _17130;
            vec2 _17131;
            float _17132;
            vec4 _17133;
            float _17134;
            vec4 _17135;
            vec4 _17136;
            vec4 _17137;
            vec4 _17152;
            if (_9694)
            {
                vec2 _6260 = vec2(_23270, _6319);
                vec2 _19530 = vec2(_12358, _12282);
                _13140 = _Globals_.g_fBurnishingNormalScale1 * _9306;
                _16305 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness1 * _9306;
                _17114 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness1 * _9306;
                _17115 = _Globals_.g_bDamageBevelUseTintMask1 != 0;
                _17116 = _Globals_.g_fDamageBevelEmboss1 * _9306;
                _17117 = _Globals_.g_fDamageHeightBlendSoftness1 * _9306;
                _17118 = _Globals_.g_fDamageBevelBlendSoftness1 * _9306;
                _17119 = _Globals_.g_fBurnishingGrime1 * _9306;
                _17120 = _Globals_.g_fGrimeRoughnessBrightness1 * _9306;
                _17121 = _Globals_.g_fBurnishingCloth1 * _9306;
                _17122 = _Globals_.g_fBurnishingMetalness1 * _9306;
                _17123 = float(_Globals_.g_bDamageBevelBlendToSubstrate1 != 0) * _9306;
                _17124 = _Globals_.g_fDamageBevelCloth1 * _9306;
                _17125 = _Globals_.g_fDamageBevelMetalness1 * _9306;
                _17126 = _Globals_.g_fDamageBevelAnisotropy1 * _9306;
                _17127 = _Globals_.g_fDamageBevelRoughnessBrightness1 * _9306;
                _17128 = _Globals_.g_vSubstrateGrimeMinMax1 * _9306;
                _17129 = _Globals_.g_vSurfaceGrimeMinMax1 * _9306;
                _17130 = _Globals_.g_vSubstrateBurnishingMinMax1 * _9306;
                _17131 = _Globals_.g_vSurfaceBurnishingMinMax1 * _9306;
                _17132 = _Globals_.g_fSubstrateCompositeColorTranslucency1 * _9306;
                _17133 = vec4(textureGrad(sampler2D(g_tGrime1, g_sTrilinearWrap), _13375.xy, vec2(_23921, _11096), vec2(_12112, _15531)).xyz * _9306, _Globals_.g_fGrimeTranslucency1 * _9306);
                _17134 = textureGrad(sampler2D(g_tDamage1, g_sTrilinearWrap), _13372.xy, vec2(_23920, _11092), vec2(_12109, _15528)).x * _9306;
                _17135 = textureGrad(sampler2D(g_tSubstrateProperties1, g_sTrilinearWrap), input_2.xy, _6260, _19530).xyzw * _9306;
                _17136 = textureGrad(sampler2D(g_tSubstrate1, g_sTrilinearWrap), input_2.xy, _6260, _19530).xyzw * _9306;
                _17137 = textureGrad(sampler2D(g_tSurfaceProperties1, g_sTrilinearWrap), input_2.xy, _6260, _19530).xyzw * _9306;
                _17152 = textureGrad(sampler2D(g_tSurface1, g_sTrilinearWrap), input_2.xy, _6260, _19530).xyzw * _9306;
                _16863 = _Globals_.g_vDamageMinMax1 * _9306;
            }
            else
            {
                _13140 = 0.0;
                _16305 = 0.0;
                _17114 = 0.0;
                _17115 = false;
                _17116 = 0.0;
                _17117 = 0.0;
                _17118 = 0.0;
                _17119 = 0.0;
                _17120 = 0.0;
                _17121 = 0.0;
                _17122 = 0.0;
                _17123 = 0.0;
                _17124 = 0.0;
                _17125 = 0.0;
                _17126 = 0.0;
                _17127 = 0.0;
                _17128 = vec2(0.0);
                _17129 = vec2(0.0);
                _17130 = vec2(0.0);
                _17131 = vec2(0.0);
                _17132 = 0.0;
                _17133 = vec4(0.0);
                _17134 = 0.0;
                _17135 = vec4(0.0);
                _17136 = vec4(0.0);
                _17137 = vec4(0.0);
                _17152 = vec4(0.0);
                _16863 = vec2(0.0);
            }
            float _13141;
            float _16306;
            vec2 _16864;
            float _17138;
            bool _17139;
            float _17140;
            float _17141;
            float _17142;
            float _17143;
            float _17145;
            float _17146;
            float _17147;
            float _17148;
            float _17149;
            float _17150;
            float _17151;
            float _17153;
            vec2 _17154;
            vec2 _17158;
            vec2 _17159;
            vec2 _17160;
            float _17161;
            vec4 _17162;
            float _17163;
            vec4 _17164;
            vec4 _17165;
            vec4 _17166;
            vec4 _17167;
            if (_17155)
            {
                vec2 _16492 = vec2(_18072, _24605);
                vec2 _19533 = vec2(_12359, _12283);
                _13141 = _Globals_.g_fBurnishingNormalScale2 * _23427;
                _16306 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness2 * _23427;
                _17138 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness2 * _23427;
                _17139 = _Globals_.g_bDamageBevelUseTintMask2 != 0;
                _17140 = _17116 + (_Globals_.g_fDamageBevelEmboss2 * _23427);
                _17141 = _17117 + (_Globals_.g_fDamageHeightBlendSoftness2 * _23427);
                _17142 = _17118 + (_Globals_.g_fDamageBevelBlendSoftness2 * _23427);
                _17143 = _17119 + (_Globals_.g_fBurnishingGrime2 * _23427);
                _17145 = _17120 + (_Globals_.g_fGrimeRoughnessBrightness2 * _23427);
                _17146 = _17121 + (_Globals_.g_fBurnishingCloth2 * _23427);
                _17147 = _17122 + (_Globals_.g_fBurnishingMetalness2 * _23427);
                _17148 = _17123 + (float(_Globals_.g_bDamageBevelBlendToSubstrate2 != 0) * _23427);
                _17149 = _17124 + (_Globals_.g_fDamageBevelCloth2 * _23427);
                _17150 = _17125 + (_Globals_.g_fDamageBevelMetalness2 * _23427);
                _17151 = _17126 + (_Globals_.g_fDamageBevelAnisotropy2 * _23427);
                _17153 = _17127 + (_Globals_.g_fDamageBevelRoughnessBrightness2 * _23427);
                _17154 = _17128 + (_Globals_.g_vSubstrateGrimeMinMax2 * _23427);
                _17158 = _17129 + (_Globals_.g_vSurfaceGrimeMinMax2 * _23427);
                _17159 = _17130 + (_Globals_.g_vSubstrateBurnishingMinMax2 * _23427);
                _17160 = _17131 + (_Globals_.g_vSurfaceBurnishingMinMax2 * _23427);
                _17161 = _17132 + (_Globals_.g_fSubstrateCompositeColorTranslucency2 * _23427);
                _17162 = vec4(_17133.xyz + (textureGrad(sampler2D(g_tGrime2, g_sTrilinearWrap), _13376.xy, vec2(_12075, _11097), vec2(_12113, _15532)).xyz * _23427), _17133.w + (_Globals_.g_fGrimeTranslucency2 * _23427));
                _17163 = _17134 + (textureGrad(sampler2D(g_tDamage2, g_sTrilinearWrap), _13373.xy, vec2(_12071, _11093), vec2(_12110, _15529)).x * _23427);
                _17164 = _17135.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties2, g_sTrilinearWrap), input_2.zw, _16492, _19533).xyzw * _23427);
                _17165 = _17136.xyzw + (textureGrad(sampler2D(g_tSubstrate2, g_sTrilinearWrap), input_2.zw, _16492, _19533).xyzw * _23427);
                _17166 = _17137.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties2, g_sTrilinearWrap), input_2.zw, _16492, _19533).xyzw * _23427);
                _17167 = _17152.xyzw + (textureGrad(sampler2D(g_tSurface2, g_sTrilinearWrap), input_2.zw, _16492, _19533).xyzw * _23427);
                _16864 = _16863 + (_Globals_.g_vDamageMinMax2 * _23427);
            }
            else
            {
                _13141 = _13140;
                _16306 = _16305;
                _17138 = _17114;
                _17139 = _17115;
                _17140 = _17116;
                _17141 = _17117;
                _17142 = _17118;
                _17143 = _17119;
                _17145 = _17120;
                _17146 = _17121;
                _17147 = _17122;
                _17148 = _17123;
                _17149 = _17124;
                _17150 = _17125;
                _17151 = _17126;
                _17153 = _17127;
                _17154 = _17128;
                _17158 = _17129;
                _17159 = _17130;
                _17160 = _17131;
                _17161 = _17132;
                _17162 = _17133;
                _17163 = _17134;
                _17164 = _17135;
                _17165 = _17136;
                _17166 = _17137;
                _17167 = _17152;
                _16864 = _16863;
            }
            float _13142;
            float _16307;
            vec2 _16865;
            float _17168;
            bool _17169;
            float _17170;
            float _17171;
            float _17172;
            float _17173;
            float _17174;
            float _17175;
            float _17176;
            float _17177;
            float _17178;
            float _17179;
            float _17180;
            float _17181;
            vec2 _17182;
            vec2 _17183;
            vec2 _17184;
            vec2 _17185;
            float _17186;
            vec4 _17187;
            float _17188;
            vec4 _17189;
            vec4 _17190;
            vec4 _17191;
            vec4 _17192;
            if (_17156)
            {
                vec2 _16494 = vec2(_18073, _24606);
                vec2 _19537 = vec2(_12360, _12284);
                _13142 = _Globals_.g_fBurnishingNormalScale3 * _23428;
                _16307 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness3 * _23428;
                _17168 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness3 * _23428;
                _17169 = _Globals_.g_bDamageBevelUseTintMask3 != 0;
                _17170 = _17140 + (_Globals_.g_fDamageBevelEmboss3 * _23428);
                _17171 = _17141 + (_Globals_.g_fDamageHeightBlendSoftness3 * _23428);
                _17172 = _17142 + (_Globals_.g_fDamageBevelBlendSoftness3 * _23428);
                _17173 = _17143 + (_Globals_.g_fBurnishingGrime3 * _23428);
                _17174 = _17145 + (_Globals_.g_fGrimeRoughnessBrightness3 * _23428);
                _17175 = _17146 + (_Globals_.g_fBurnishingCloth3 * _23428);
                _17176 = _17147 + (_Globals_.g_fBurnishingMetalness3 * _23428);
                _17177 = _17148 + (float(_Globals_.g_bDamageBevelBlendToSubstrate3 != 0) * _23428);
                _17178 = _17149 + (_Globals_.g_fDamageBevelCloth3 * _23428);
                _17179 = _17150 + (_Globals_.g_fDamageBevelMetalness3 * _23428);
                _17180 = _17151 + (_Globals_.g_fDamageBevelAnisotropy3 * _23428);
                _17181 = _17153 + (_Globals_.g_fDamageBevelRoughnessBrightness3 * _23428);
                _17182 = _17154 + (_Globals_.g_vSubstrateGrimeMinMax3 * _23428);
                _17183 = _17158 + (_Globals_.g_vSurfaceGrimeMinMax3 * _23428);
                _17184 = _17159 + (_Globals_.g_vSubstrateBurnishingMinMax3 * _23428);
                _17185 = _17160 + (_Globals_.g_vSurfaceBurnishingMinMax3 * _23428);
                _17186 = _17161 + (_Globals_.g_fSubstrateCompositeColorTranslucency3 * _23428);
                _17187 = vec4(_17162.xyz + (textureGrad(sampler2D(g_tGrime3, g_sTrilinearWrap), _13377.xy, vec2(_12076, _11098), vec2(_12114, _15533)).xyz * _23428), _17162.w + (_Globals_.g_fGrimeTranslucency3 * _23428));
                _17188 = _17163 + (textureGrad(sampler2D(g_tDamage3, g_sTrilinearWrap), _13374.xy, vec2(_12072, _11094), vec2(_12111, _15530)).x * _23428);
                _17189 = _17164.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties3, g_sTrilinearWrap), input_3.xy, _16494, _19537).xyzw * _23428);
                _17190 = _17165.xyzw + (textureGrad(sampler2D(g_tSubstrate3, g_sTrilinearWrap), input_3.xy, _16494, _19537).xyzw * _23428);
                _17191 = _17166.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties3, g_sTrilinearWrap), input_3.xy, _16494, _19537).xyzw * _23428);
                _17192 = _17167.xyzw + (textureGrad(sampler2D(g_tSurface3, g_sTrilinearWrap), input_3.xy, _16494, _19537).xyzw * _23428);
                _16865 = _16864 + (_Globals_.g_vDamageMinMax3 * _23428);
            }
            else
            {
                _13142 = _13141;
                _16307 = _16306;
                _17168 = _17138;
                _17169 = _17139;
                _17170 = _17140;
                _17171 = _17141;
                _17172 = _17142;
                _17173 = _17143;
                _17174 = _17145;
                _17175 = _17146;
                _17176 = _17147;
                _17177 = _17148;
                _17178 = _17149;
                _17179 = _17150;
                _17180 = _17151;
                _17181 = _17153;
                _17182 = _17154;
                _17183 = _17158;
                _17184 = _17159;
                _17185 = _17160;
                _17186 = _17161;
                _17187 = _17162;
                _17188 = _17163;
                _17189 = _17164;
                _17190 = _17165;
                _17191 = _17166;
                _17192 = _17167;
                _16865 = _16864;
            }
            vec4 _6616;
            bool _13694;
            float _17210;
            float _17211;
            float _17213;
            vec4 _17214;
            vec4 _17215;
            vec4 _17216;
            if (_17157)
            {
                vec2 _16496 = vec2(_18074, _24607);
                vec2 _19541 = vec2(_9869, _13119);
                _13143 = _17185 + (_Globals_.g_vSurfaceBurnishingMinMax4 * _23429);
                _16308 = _17183 + (_Globals_.g_vSurfaceGrimeMinMax4 * _23429);
                _17193 = _17184 + (_Globals_.g_vSubstrateBurnishingMinMax4 * _23429);
                _17194 = _17182 + (_Globals_.g_vSubstrateGrimeMinMax4 * _23429);
                _17195 = _17188 + (textureGrad(sampler2D(g_tDamage4, g_sTrilinearWrap), _13435.xy, vec2(_12073, _11095), vec2(_12074, _13120)).x * _23429);
                _17196 = vec4(_17187.xyz + (textureGrad(sampler2D(g_tGrime4, g_sTrilinearWrap), _13436.xy, vec2(_12077, _11099), vec2(_15263, _6641)).xyz * _23429), _17187.w + (_Globals_.g_fGrimeTranslucency4 * _23429));
                _17197 = _16865 + (_Globals_.g_vDamageMinMax4 * _23429);
                _17198 = _17174 + (_Globals_.g_fGrimeRoughnessBrightness4 * _23429);
                _17199 = _17178 + (_Globals_.g_fDamageBevelCloth4 * _23429);
                _17200 = _17177 + (float(_Globals_.g_bDamageBevelBlendToSubstrate4 != 0) * _23429);
                _17201 = _17176 + (_Globals_.g_fBurnishingMetalness4 * _23429);
                _17202 = _17175 + (_Globals_.g_fBurnishingCloth4 * _23429);
                _17203 = _17173 + (_Globals_.g_fBurnishingGrime4 * _23429);
                _17204 = _Globals_.g_fBurnishingNormalScale4 * _23429;
                _17205 = _Globals_.g_fSurfaceBurnishingRoughnessBrightness4 * _23429;
                _17206 = _Globals_.g_fSubstrateBurnishingRoughnessBrightness4 * _23429;
                _17207 = _17171 + (_Globals_.g_fDamageHeightBlendSoftness4 * _23429);
                _17208 = _17172 + (_Globals_.g_fDamageBevelBlendSoftness4 * _23429);
                _17209 = _17170 + (_Globals_.g_fDamageBevelEmboss4 * _23429);
                _17210 = _17180 + (_Globals_.g_fDamageBevelAnisotropy4 * _23429);
                _17211 = _17181 + (_Globals_.g_fDamageBevelRoughnessBrightness4 * _23429);
                _17212 = _17179 + (_Globals_.g_fDamageBevelMetalness4 * _23429);
                _17213 = _17186 + (_Globals_.g_fSubstrateCompositeColorTranslucency4 * _23429);
                _17214 = _17189.xyzw + (textureGrad(sampler2D(g_tSubstrateProperties4, g_sTrilinearWrap), input_3.zw, _16496, _19541).xyzw * _23429);
                _17215 = _17190.xyzw + (textureGrad(sampler2D(g_tSubstrate4, g_sTrilinearWrap), input_3.zw, _16496, _19541).xyzw * _23429);
                _17216 = _17191.xyzw + (textureGrad(sampler2D(g_tSurfaceProperties4, g_sTrilinearWrap), input_3.zw, _16496, _19541).xyzw * _23429);
                _13694 = _Globals_.g_bDamageBevelUseTintMask4 != 0;
                _6616 = _17192.xyzw + (textureGrad(sampler2D(g_tSurface4, g_sTrilinearWrap), input_3.zw, _16496, _19541).xyzw * _23429);
            }
            else
            {
                _13143 = _17185;
                _16308 = _17183;
                _17193 = _17184;
                _17194 = _17182;
                _17195 = _17188;
                _17196 = _17187;
                _17197 = _16865;
                _17198 = _17174;
                _17199 = _17178;
                _17200 = _17177;
                _17201 = _17176;
                _17202 = _17175;
                _17203 = _17173;
                _17204 = _13142;
                _17205 = _16307;
                _17206 = _17168;
                _17207 = _17171;
                _17208 = _17172;
                _17209 = _17170;
                _17210 = _17180;
                _17211 = _17181;
                _17212 = _17179;
                _17213 = _17186;
                _17214 = _17189;
                _17215 = _17190;
                _17216 = _17191;
                _13694 = _17169;
                _6616 = _17192;
            }
            _14876 = _Globals_.g_fPatternPaintRespectsTintMask != 0;
            if (_14876)
            {
                _21710 = _6616.w;
            }
            else
            {
                _21710 = max(_6616.w, 0.0);
            }
            bool _6220;
            float _16309;
            float _18473;
            mat4 _19935 = mat4((((_Globals_.g_mSurfaceBurnishingColorAdjust1[0] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[0] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[0] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[0] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[1] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[1] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[1] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[1] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[2] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[2] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[2] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[2] * _23429), (((_Globals_.g_mSurfaceBurnishingColorAdjust1[3] * _9306) + (_Globals_.g_mSurfaceBurnishingColorAdjust2[3] * _23427)) + (_Globals_.g_mSurfaceBurnishingColorAdjust3[3] * _23428)) + (_Globals_.g_mSurfaceBurnishingColorAdjust4[3] * _23429));
            _13560 = _17216.x;
            _16973 = _17216.y;
            _8530 = _17216.z * (1.0 - _16973);
            _22892 = _17216.w;
            vec4 _24833 = vec4(_6616.xyz, 1.0);
            vec4 _11580 = vec4((_24833 * mat4((((_Globals_.g_mSurfaceColorAdjust1[0] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[0] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[0] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[0] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[1] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[1] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[1] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[1] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[2] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[2] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[2] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[2] * _23429), (((_Globals_.g_mSurfaceColorAdjust1[3] * _9306) + (_Globals_.g_mSurfaceColorAdjust2[3] * _23427)) + (_Globals_.g_mSurfaceColorAdjust3[3] * _23428)) + (_Globals_.g_mSurfaceColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18226 = _11580.xyz;
            vec3 _16611;
            do
            {
                float _20940;
                do
                {
                    _18473 = max(_21709.x, max(_21709.y, _21709.z));
                    _16309 = _18473 - min(_21709.x, min(_21709.y, _21709.z));
                    _6220 = _18473 == 0.0;
                    if (_6220)
                    {
                        _20940 = 0.0;
                        break;
                    }
                    _20940 = _16309 / _18473;
                    break;
                } while(false);
                float _12835 = dot(_21709.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
                float _23052 = max(dot(_11580.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                if (_12835 > 0.0)
                {
                    vec3 _22572 = normalize(_21709.xyz).xyz - vec3(0.57700002193450927734375);
                    vec3 _7057 = saturate((normalize(_22572) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15712 = _7057 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16611 = mix((_18226 * mix(1.0, min(max(1.0 + (4.0 * (_12835 - 0.5)), mix(0.02999999932944774627685546875, 0.134000003337860107421875, _16973) / _23052), mix(0.89999997615814208984375, 0.980000019073486328125, _16973) / _23052), _21709.w)).xyz, _7057 * (_12835 / ((_15712.x + _15712.y) + _15712.z)), vec3(saturate(_20940 * pow(abs(dot(_22572, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _21709.w));
                    break;
                }
                else
                {
                    _16611 = _18226;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            _19312 = mix(_6616.xyz, _16611, vec3(_21710));
            _23992 = vec3((_24833 * _19935).xyz);
            float _21711;
            if (_14876)
            {
                _21711 = _17215.w;
            }
            else
            {
                _21711 = max(_17215.w, 0.0);
            }
            vec3 _7901;
            float _9231;
            float _12836;
            bool _15230;
            _16297 = _17214.x;
            _6536 = _17214.y;
            _8568 = _17214.z * (1.0 - _6536);
            _23574 = _17214.w;
            float _16069 = _21709.w * _17213;
            vec4 _24834 = vec4(_17215.xyz, 1.0);
            vec4 _11581 = vec4((_24834 * mat4((((_Globals_.g_mSubstrateColorAdjust1[0] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[0] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[0] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[0] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[1] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[1] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[1] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[1] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[2] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[2] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[2] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[2] * _23429), (((_Globals_.g_mSubstrateColorAdjust1[3] * _9306) + (_Globals_.g_mSubstrateColorAdjust2[3] * _23427)) + (_Globals_.g_mSubstrateColorAdjust3[3] * _23428)) + (_Globals_.g_mSubstrateColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18227 = _11581.xyz;
            vec3 _16612;
            do
            {
                _7901 = _21709.xyz;
                float _20941;
                do
                {
                    if (_6220)
                    {
                        _20941 = 0.0;
                        break;
                    }
                    _20941 = _16309 / _18473;
                    break;
                } while(false);
                _12836 = dot(_21709.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
                float _23053 = max(dot(_11581.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                _9231 = 4.0 * (_12836 - 0.5);
                _15230 = _12836 > 0.0;
                if (_15230)
                {
                    vec3 _22573 = normalize(_7901).xyz - vec3(0.57700002193450927734375);
                    vec3 _7060 = saturate((normalize(_22573) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15713 = _7060 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16612 = mix((_18227 * mix(1.0, min(max(1.0 + _9231, mix(0.02999999932944774627685546875, 0.134000003337860107421875, _6536) / _23053), mix(0.89999997615814208984375, 0.980000019073486328125, _6536) / _23053), _16069)).xyz, _7060 * (_12836 / ((_15713.x + _15713.y) + _15713.z)), vec3(saturate(_20941 * pow(abs(dot(_22573, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _16069));
                    break;
                }
                else
                {
                    _16612 = _18227;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            _19313 = mix(_17215.xyz, _16612, vec3(_21711));
            _12902 = vec3((_24834 * mat4((((_Globals_.g_mSubstrateBurnishingColorAdjust1[0] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[0] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[0] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[0] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[1] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[1] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[1] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[1] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[2] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[2] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[2] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[2] * _23429), (((_Globals_.g_mSubstrateBurnishingColorAdjust1[3] * _9306) + (_Globals_.g_mSubstrateBurnishingColorAdjust2[3] * _23427)) + (_Globals_.g_mSubstrateBurnishingColorAdjust3[3] * _23428)) + (_Globals_.g_mSubstrateBurnishingColorAdjust4[3] * _23429))).xyz);
            vec4 _11582 = vec4((_24833 * mat4((((_Globals_.g_mDamageColorAdjust1[0] * _9306) + (_Globals_.g_mDamageColorAdjust2[0] * _23427)) + (_Globals_.g_mDamageColorAdjust3[0] * _23428)) + (_Globals_.g_mDamageColorAdjust4[0] * _23429), (((_Globals_.g_mDamageColorAdjust1[1] * _9306) + (_Globals_.g_mDamageColorAdjust2[1] * _23427)) + (_Globals_.g_mDamageColorAdjust3[1] * _23428)) + (_Globals_.g_mDamageColorAdjust4[1] * _23429), (((_Globals_.g_mDamageColorAdjust1[2] * _9306) + (_Globals_.g_mDamageColorAdjust2[2] * _23427)) + (_Globals_.g_mDamageColorAdjust3[2] * _23428)) + (_Globals_.g_mDamageColorAdjust4[2] * _23429), (((_Globals_.g_mDamageColorAdjust1[3] * _9306) + (_Globals_.g_mDamageColorAdjust2[3] * _23427)) + (_Globals_.g_mDamageColorAdjust3[3] * _23428)) + (_Globals_.g_mDamageColorAdjust4[3] * _23429))).xyz, _2);
            vec3 _18228 = _11582.xyz;
            vec3 _16613;
            do
            {
                float _20942;
                do
                {
                    if (_6220)
                    {
                        _20942 = 0.0;
                        break;
                    }
                    _20942 = _16309 / _18473;
                    break;
                } while(false);
                float _17217 = max(dot(_11582.xyz, vec3(0.300000011920928955078125, 0.589999973773956298828125, 0.10999999940395355224609375)), 0.001000000047497451305389404296875);
                if (_15230)
                {
                    vec3 _22574 = normalize(_7901).xyz - vec3(0.57700002193450927734375);
                    vec3 _7061 = saturate((normalize(_22574) * 2.0) + vec3(1.0)).xyz;
                    vec3 _15714 = _7061 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
                    _16613 = mix((_18228 * mix(1.0, min(max(1.0 + _9231, mix(0.02999999932944774627685546875, 0.134000003337860107421875, _17212) / _17217), mix(0.89999997615814208984375, 0.980000019073486328125, _17212) / _17217), _16069)).xyz, _7061 * (_12836 / ((_15714.x + _15714.y) + _15714.z)), vec3(saturate(_20942 * pow(abs(dot(_22574, vec3(0.57700002193450927734375))), 0.20000000298023223876953125)) * _16069));
                    break;
                }
                else
                {
                    _16613 = _18228;
                    break;
                }
                break; // unreachable workaround
            } while(false);
            _11467 = mix(_19312.xyz, _16613, vec3(_13694 ? _21710 : 1.0));
            _7079 = vec4((vec4(vec4(_11467.xyz, 1.0).xyz, 1.0) * _19935).xyz, 1.0).xyz;
            vec2 _23650 = _23299.xz * _17211;
            _9596 = _23650;
            _9596.y = mix(_23650.x, _23650.y, _17210);
        }
        bool _12916;
        if (_14875)
        {
            _12916 = _Globals_.g_bPatternPaintLayer != 0;
        }
        else
        {
            _12916 = false;
        }
        vec3 _13149;
        float _16317;
        float _16480;
        float _17333;
        float _17334;
        vec3 _17335;
        vec2 _17336;
        vec3 _17337;
        float _17338;
        float _17339;
        SPIRV_CROSS_BRANCH
        if (_12916)
        {
            float _8186 = (_13155 * _24878.w) * (_14876 ? _21710 : 1.0);
            vec3 _12121 = vec3(_8186);
            vec3 _10574 = mix(_19312, _24878.xyz, _12121);
            float _13148;
            vec3 _16316;
            float _16479;
            vec3 _17330;
            float _17331;
            float _17332;
            SPIRV_CROSS_BRANCH
            if (_14874)
            {
                float _9808 = saturate(_9716 - _Globals_.g_fPatternTranslucencyThreshold) * _8186;
                vec3 _22239 = _7244 + (vec3(0.0, 0.0, 1.0) * _9716);
                vec3 _23794 = normalize((input_5.xyz * 1.0).xyz).xyz;
                vec3 _9001 = normalize(mix(_23794, _23794 + normalize(cross(dFdyFine(_22239), dFdxFine(_22239))).xyz, vec3((_Globals_.g_fPatternEmboss * _8186) * _5625))).xyz;
                vec2 _15752 = mix(_14854, normalize(vec3(vec2(_16785, _11178), (1.0 - abs(_16785)) - abs(_11178))), _12121).xy + vec3(dot(_9001, input_6.xyz), dot(_9001, _20527.xyz), _3).xy;
                vec3 _20488;
                _20488.x = _15752.x;
                _20488.y = _15752.y;
                _13148 = _22892 + ((_Globals_.g_fPatternEmboss < 0.0) ? 0.0 : _9808);
                _16316 = _20488;
                _17330 = mix(_10574, _24878.xyz, _12121);
                _17331 = mix(_17207, 0.0, _9808);
                _17332 = mix(_17208, 0.00999999977648258209228515625, _9808);
                _16479 = mix(_17209, max(0.0, _Globals_.g_fPatternEmboss), _9808);
            }
            else
            {
                _13148 = _22892;
                _16316 = _14854;
                _17330 = _11467;
                _17331 = _17207;
                _17332 = _17208;
                _16479 = _17209;
            }
            _13149 = _10574;
            _16317 = _13148;
            _17333 = mix(_16973, _20706.x, _8186);
            _17334 = mix(_8530, _Globals_.g_fPatternCloth, _8186);
            _17335 = _16316;
            _17336 = mix(_23299.xz, vec2(_20706.y), vec2(_8186));
            _17337 = _17330;
            _17338 = _17331;
            _17339 = _17332;
            _16480 = _16479;
        }
        else
        {
            _13149 = _19312;
            _16317 = _22892;
            _17333 = _16973;
            _17334 = _8530;
            _17335 = _14854;
            _17336 = _23299.xz;
            _17337 = _11467;
            _17338 = _17207;
            _17339 = _17208;
            _16480 = _17209;
        }
        _13150 = _13149;
        _16322 = _23992;
        _17340 = _13560;
        _17342 = _16317;
        _17343 = _17333;
        _17344 = _17334;
        _17345 = _17335;
        _17346 = _17336;
        _17347 = _13143;
        _17354 = _16308;
        _17355 = _19313;
        _17356 = _12902;
        _17357 = _16297;
        _17358 = _23574;
        _17359 = _8568;
        _17360 = _6536;
        _17361 = _17193;
        _17362 = _17194;
        _17363 = _17337;
        _17364 = _7079;
        _17365 = _17195;
        _17366 = _17338;
        _17367 = _9596;
        _17368 = _17196;
        _17369 = _17197;
        _17370 = _17198;
        _17371 = _17339;
        _17372 = _17212;
        _17373 = _17199;
        _17374 = _17200;
        _17375 = _17201;
        _17378 = _16480;
        _17379 = _17202;
        _17380 = _17203;
        _17381 = _17204;
        _13998 = _17205;
        _23300 = _17206;
        break;
    } while(false);
    vec4 _19374 = texture(sampler2D(g_tObjectProperties, g_sAniso), input_0.xy);
    float _14499 = _17342 - _17358;
    float _23339 = ((((2.0 - ((_Globals_.g_fWearProgress * (_17369.y - _17369.x)) + _17369.x)) - _17365) - _19374.y) - _17342) + _14499;
    float _17421 = smoothstep(-_17366, _17366, (_23339 * _14499) / _17366);
    float _6542 = max(min(_17342, saturate(_23339)), _17358);
    float _15773 = _23339 / _17371;
    float _10874 = smoothstep(1.0 + _17371, 1.0 - _17371, _15773);
    float _22419 = saturate(_15773);
    float _8519 = saturate((_Globals_.g_fWearProgress - 1.0) + _19374.z) * (_6542 + _Globals_.g_fWearProgress);
    float _10058 = smoothstep(_17361.x, _17361.y, _8519);
    float _7769 = saturate(_8519);
    float _20239 = _19374.x * mix(mix(_17357, _17340, _17421) * saturate(1.0 - ((((saturate((_6542 + 0.00999999977648258209228515625) / _17366) * (1.0 - saturate((_6542 - 0.00999999977648258209228515625) / _17366))) * _17421) * _17342) * 0.75)), 1.0, _10058);
    vec3 _9818 = mix(_17355, _17356, vec3(_10058));
    vec3 _12925 = vec3(smoothstep(_17347.x, _17347.y, _8519));
    vec4 _19375 = texture(sampler2D(g_tNormal, g_sAniso), input_0.xy);
    float _16000 = _19375.x;
    float _19720 = _19375.y;
    float _16786 = (_16000 + _19720) - 1.00392162799835205078125;
    float _11179 = _16000 - _19720;
    vec3 _19308 = normalize(vec3(vec2(_16786, _11179), (1.0 - abs(_16786)) - abs(_11179)));
    float _20108 = mix(1.0, _17381, _7769);
    vec2 _22350 = vec2(_17421);
    vec2 _23011 = _19308.xy + (mix(_23430, _17345.xy, _22350) * _20108);
    vec3 _24090 = _20527.xyz;
    vec3 _8665 = _7244 + (vec3(0.0, 0.0, 1.0) * _15773);
    vec3 _10113 = dFdxFine(_8665);
    vec3 _19987 = dFdyFine(_8665);
    vec3 _23795 = normalize((((input_6.xyz * _23011.x).xyz + (_24090 * _23011.y)).xyz + (input_5.xyz * _19308.z)).xyz).xyz;
    vec3 _6524 = normalize(mix(_23795, _23795 + normalize(cross(_19987, _10113)).xyz, vec3(((((smoothstep(-_17371, _17371, _15773) * _10874) * _20108) * _17378) * _5625) * _14499)));
    vec3 _10312 = _6524.xyz;
    float _18095 = dot(_10312, input_6.xyz);
    float _6548 = dot(_10312, _24090);
    float _16292 = _6524.z;
    vec2 _18006 = mix(_13192.xz, mix(_17346.xy, _17367.xy, vec2(_10874)), _22350).xy * mix(1.0, mix(_23300, _13998, _22419), _7769);
    float _11266 = (_6542 * _20239) * (_Globals_.g_fWearProgress * 2.0);
    float _19211 = mix(smoothstep(_17362.x, _17362.y, _11266), smoothstep(_17354.x, _17354.y, _11266), mix(_17421, 1.0 - _10874, _17374)) * (1.0 - min(_18006.x, _18006.y));
    float _13440 = mix(_19211, max(_19211, _17380), _7769) * _17368.w;
    vec2 _14940 = mix(_18006.xy, _18006.xx * _17370, vec2(_13440));
    float _20536 = _14940.x;
    float _7253 = _14940.y;
    float _9119 = mix(mix(_17360, mix(_17343, _17372, _10874), _17421), _17375, _7769) * (1.0 - _13440);
    float _8280 = mix(mix(_17359, mix(_17344, _17373, _10874), _17421), _17379, _7769) * (1.0 - _9119);
    vec4 _6805;
    SPIRV_CROSS_BRANCH
    if (_Globals_.g_nOutputMode == 0)
    {
        _6805 = vec4(mix(mix(_9818, mix(mix(_13150, _16322, _12925), mix(mix(_17363, _17364, _12925), _9818, vec3(_17374 * (1.0 - _22419))), vec3(_10874)), vec3(_17421)).xyz, _17368.xyz, vec3(_13440)).xyz, 1.0);
    }
    else
    {
        vec4 _12506;
        if (_Globals_.g_nOutputMode == 1)
        {
            vec3 _16929 = vec3(_18095, _6548, _16292).xyz / vec3((abs(_18095) + abs(_6548)) + abs(_16292));
            float _10674 = _16929.x;
            float _23725 = _16929.y;
            vec2 _21979 = (vec2(_10674 + _23725, _10674 - _23725) * 0.5) + vec2(0.5);
            vec3 _16636 = vec3(_21979.xy, _20536).xyz;
            vec3 _10600 = _16636 * vec3(0.077399380505084991455078125);
            vec3 _7710 = pow((_16636 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
            float _21354;
            if (_21979.x <= 0.040449999272823333740234375)
            {
                _21354 = _10600.x;
            }
            else
            {
                _21354 = _7710.x;
            }
            float _23037;
            if (_21979.y <= 0.040449999272823333740234375)
            {
                _23037 = _10600.y;
            }
            else
            {
                _23037 = _7710.y;
            }
            float _19477;
            if (_20536 <= 0.040449999272823333740234375)
            {
                _19477 = _10600.z;
            }
            else
            {
                _19477 = _7710.z;
            }
            _12506 = vec4(vec3(_21354, _23037, _19477), _7253);
        }
        else
        {
            vec4 _12505;
            if (_Globals_.g_nOutputMode == 2)
            {
                vec3 _20866 = vec3(0.0, _9119, _8280).xyz;
                vec3 _10599 = _20866 * vec3(0.077399380505084991455078125);
                vec3 _7709 = pow((_20866 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                float _23036;
                if (_9119 <= 0.040449999272823333740234375)
                {
                    _23036 = _10599.y;
                }
                else
                {
                    _23036 = _7709.y;
                }
                float _19476;
                if (_8280 <= 0.040449999272823333740234375)
                {
                    _19476 = _10599.z;
                }
                else
                {
                    _19476 = _7709.z;
                }
                _12505 = vec4(vec3(_10599.x, _23036, _19476), 1.0);
            }
            else
            {
                vec4 _12503;
                if (_Globals_.g_nOutputMode == 3)
                {
                    vec3 _20865 = vec3(_20239).xyz;
                    vec3 _10598 = _20865 * vec3(0.077399380505084991455078125);
                    vec3 _9358 = pow((_20865 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                    bool _17061 = _20239 <= 0.040449999272823333740234375;
                    float _12917;
                    if (_17061)
                    {
                        _12917 = _10598.x;
                    }
                    else
                    {
                        _12917 = _9358.x;
                    }
                    float _12918;
                    if (_17061)
                    {
                        _12918 = _10598.y;
                    }
                    else
                    {
                        _12918 = _9358.y;
                    }
                    float _19475;
                    if (_17061)
                    {
                        _19475 = _10598.z;
                    }
                    else
                    {
                        _19475 = _9358.z;
                    }
                    _12503 = vec4(vec3(_12917, _12918, _19475), 1.0);
                }
                else
                {
                    vec4 _12502;
                    if (_Globals_.g_nOutputMode == 4)
                    {
                        vec3 _16635 = vec3(_14940.xy, 0.0).xyz;
                        vec3 _10597 = _16635 * vec3(0.077399380505084991455078125);
                        vec3 _9357 = pow((_16635 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                        float _23035;
                        if (_20536 <= 0.040449999272823333740234375)
                        {
                            _23035 = _10597.x;
                        }
                        else
                        {
                            _23035 = _9357.x;
                        }
                        float _19302;
                        if (_7253 <= 0.040449999272823333740234375)
                        {
                            _19302 = _10597.y;
                        }
                        else
                        {
                            _19302 = _9357.y;
                        }
                        _12502 = vec4(vec3(_23035, _19302, _10597.z), 1.0);
                    }
                    else
                    {
                        _12502 = vec4(0.5, 0.5, 0.5, 1.0);
                    }
                    _12503 = _12502;
                }
                _12505 = _12503;
            }
            _12506 = _12505;
        }
        _6805 = _12506;
    }
    output_0 = _6805;
}


