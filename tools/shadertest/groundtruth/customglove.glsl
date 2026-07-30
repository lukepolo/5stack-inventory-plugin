// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 3 (name: g_vTextileAlbedoLevels) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (45156 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup

#version 460
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

const vec3 _1329[9] = vec3[](vec3(0.0, 0.0, 0.31972789764404296875), vec3(-1.0, -1.0, 0.051020406186580657958984375), vec3(-1.0, 0.0, 0.119047619402408599853515625), vec3(-1.0, 1.0, 0.051020406186580657958984375), vec3(0.0, -1.0, 0.119047619402408599853515625), vec3(0.0, 1.0, 0.119047619402408599853515625), vec3(1.0, -1.0, 0.051020406186580657958984375), vec3(1.0, 0.0, 0.119047619402408599853515625), vec3(1.0, 1.0, 0.051020406186580657958984375));
const vec2 _592[4] = vec2[](vec2(-1.0), vec2(-1.0, 1.0), vec2(1.0), vec2(1.0, -1.0));
vec3 _2;

struct _2422
{
    int g_bPattern;
    float g_flSheenScale;
    int g_nOutputMode;
    vec3 g_vTextileAlbedoLevels;
    vec3 g_vMetallicTextileAlbedoLevels;
    vec4 g_vGrungeTexCoordXform0;
    vec4 g_vGrungeTexCoordXform1;
    vec4 g_vGrungeTexRotationXform0;
    vec4 g_vGrungeTexRotationXform1;
    float g_fWearProgress;
    float g_fDetailBlackPoint1;
    float g_fDetailBlackPointCompensation1;
    float g_fDetailScale1;
    float g_fDetailRoughnessContrast1;
    float g_fDetailRoughnessBrightness1;
    float g_fDetailMetalness1;
    float g_fDetailCloth1;
    float g_fDetailNormalContrast1;
    vec2 g_vDamageLevels1;
    float g_fDamageRoughnessContrast1;
    float g_fDamageRoughnessBrightness1;
    float g_fDamageSaturation1;
    float g_fDamageBrightness1;
    float g_fDamageMetalness1;
    float g_fDamageCloth1;
    float g_fDamageBleaching1;
    float g_fCurvaturePower1;
    float g_fCurvatureWearBoost1;
    float g_fDamageNormalEdgeWidth1;
    float g_fDamageEdgeRoughness1;
    float g_fDamageEdgeMetalness1;
    float g_fDetailGrunge1;
    float g_fGrungeMax1;
    float g_fGrungeRoughnessBrightness1;
    float g_fWearBleaching1;
    float g_fGrimeSaturation1;
    float g_fGrimeBrightness1;
    float g_fColorMaskBlur;
    float g_fFlipFixup;
    vec4 g_vPatternTexCoordXform0;
    vec4 g_vPatternTexCoordXform1;
    vec4 g_vPatternTexRotationXform0;
    vec4 g_vPatternTexRotationXform1;
    float g_fPatternRoughnessBrightness;
    float g_fPatternMetalness;
    float g_fPaintThickness;
    float g_fPaintDurability;
    float g_fPaintShadowPower;
    float g_fPatternDetailInfluence;
    int g_nPatternReplaceIndex;
    int g_nPatternMode;
    vec3 g_vColorTint1;
    vec3 g_vColorTint2;
    vec3 g_vColorTint3;
    vec3 g_vColorTint4;
    vec3 g_vColorTint5;
    vec3 g_vColorTint6;
    vec3 g_vColorTint7;
    vec3 g_vColorTint8;
    ivec4 g_vPatternPaletteIndices;
    float g_fDetailBlackPoint2;
    float g_fDetailBlackPointCompensation2;
    float g_fDetailScale2;
    float g_fDetailRoughnessContrast2;
    float g_fDetailRoughnessBrightness2;
    float g_fDetailMetalness2;
    float g_fDetailCloth2;
    float g_fDetailNormalContrast2;
    vec2 g_vDamageLevels2;
    float g_fDamageRoughnessContrast2;
    float g_fDamageRoughnessBrightness2;
    float g_fDamageSaturation2;
    float g_fDamageBrightness2;
    float g_fDamageMetalness2;
    float g_fDamageCloth2;
    float g_fDamageBleaching2;
    float g_fCurvaturePower2;
    float g_fCurvatureWearBoost2;
    float g_fDamageNormalEdgeWidth2;
    float g_fDamageEdgeRoughness2;
    float g_fDamageEdgeMetalness2;
    float g_fDetailGrunge2;
    float g_fGrungeMax2;
    float g_fGrungeRoughnessBrightness2;
    float g_fWearBleaching2;
    float g_fGrimeSaturation2;
    float g_fGrimeBrightness2;
    float g_fDetailBlackPoint3;
    float g_fDetailBlackPointCompensation3;
    float g_fDetailScale3;
    float g_fDetailRoughnessContrast3;
    float g_fDetailRoughnessBrightness3;
    float g_fDetailMetalness3;
    float g_fDetailCloth3;
    float g_fDetailNormalContrast3;
    vec2 g_vDamageLevels3;
    float g_fDamageRoughnessContrast3;
    float g_fDamageRoughnessBrightness3;
    float g_fDamageSaturation3;
    float g_fDamageBrightness3;
    float g_fDamageMetalness3;
    float g_fDamageCloth3;
    float g_fDamageBleaching3;
    float g_fCurvaturePower3;
    float g_fCurvatureWearBoost3;
    float g_fDamageNormalEdgeWidth3;
    float g_fDamageEdgeRoughness3;
    float g_fDamageEdgeMetalness3;
    float g_fDetailGrunge3;
    float g_fGrungeMax3;
    float g_fGrungeRoughnessBrightness3;
    float g_fWearBleaching3;
    float g_fGrimeSaturation3;
    float g_fGrimeBrightness3;
    float g_fDetailBlackPoint4;
    float g_fDetailBlackPointCompensation4;
    float g_fDetailScale4;
    float g_fDetailRoughnessContrast4;
    float g_fDetailRoughnessBrightness4;
    float g_fDetailMetalness4;
    float g_fDetailCloth4;
    float g_fDetailNormalContrast4;
    vec2 g_vDamageLevels4;
    float g_fDamageRoughnessContrast4;
    float g_fDamageRoughnessBrightness4;
    float g_fDamageSaturation4;
    float g_fDamageBrightness4;
    float g_fDamageMetalness4;
    float g_fDamageCloth4;
    float g_fDamageBleaching4;
    float g_fCurvaturePower4;
    float g_fCurvatureWearBoost4;
    float g_fDamageNormalEdgeWidth4;
    float g_fDamageEdgeRoughness4;
    float g_fDamageEdgeMetalness4;
    float g_fDetailGrunge4;
    float g_fGrungeMax4;
    float g_fGrungeRoughnessBrightness4;
    float g_fWearBleaching4;
    float g_fGrimeSaturation4;
    float g_fGrimeBrightness4;
};

layout(set = 1) uniform _2422 _Globals_;

layout(set = 1, binding = 37) uniform texture2D g_tLayerMask;
layout(set = 1, binding = 17) uniform sampler g_sTrilinearWrap;
layout(set = 1, binding = 30) uniform texture2D g_tSurface;
layout(set = 1, binding = 33) uniform texture2D g_tDetail1;
layout(set = 1, binding = 39) uniform texture2D g_tDetail2;
layout(set = 1, binding = 43) uniform texture2D g_tDetail3;
layout(set = 1, binding = 47) uniform texture2D g_tDetail4;
layout(set = 1, binding = 36) uniform texture2D g_tGrunge1;
layout(set = 1, binding = 42) uniform texture2D g_tGrunge2;
layout(set = 1, binding = 46) uniform texture2D g_tGrunge3;
layout(set = 1, binding = 50) uniform texture2D g_tGrunge4;
layout(set = 1, binding = 32) uniform texture2D g_tNoise;
layout(set = 1, binding = 15) uniform sampler g_sAniso;
layout(set = 1, binding = 31) uniform texture2D g_tNormal;
layout(set = 1, binding = 34) uniform texture2D g_tDetailNormal1;
layout(set = 1, binding = 40) uniform texture2D g_tDetailNormal2;
layout(set = 1, binding = 44) uniform texture2D g_tDetailNormal3;
layout(set = 1, binding = 48) uniform texture2D g_tDetailNormal4;
layout(set = 1, binding = 35) uniform texture2D g_tDamageNormal1;
layout(set = 1, binding = 41) uniform texture2D g_tDamageNormal2;
layout(set = 1, binding = 45) uniform texture2D g_tDamageNormal3;
layout(set = 1, binding = 49) uniform texture2D g_tDamageNormal4;
layout(set = 1, binding = 14) uniform sampler g_sPoint;
layout(set = 1, binding = 38) uniform texture2D g_tPattern;

layout(location = 0) in vec4 input_0;
layout(location = 0) out vec4 output_0;

void main()
{
    vec2 _13810 = input_0.xy;
    vec4 _21836 = texture(sampler2D(g_tLayerMask, g_sTrilinearWrap), input_0.xy);
    float _13915 = _21836.x;
    float _21941 = _21836.y;
    float _24699 = _21836.z;
    float _22165 = mix(mix(mix(_Globals_.g_fDetailMetalness1, _Globals_.g_fDetailMetalness2, _13915), _Globals_.g_fDetailMetalness3, _21941), _Globals_.g_fDetailMetalness4, _24699);
    vec2 _8506 = vec2(_13915);
    vec2 _14169 = vec2(_21941);
    vec2 _13884 = vec2(_24699);
    vec2 _7502 = mix(mix(mix(_Globals_.g_vDamageLevels1, _Globals_.g_vDamageLevels2, _8506), _Globals_.g_vDamageLevels3, _14169), _Globals_.g_vDamageLevels4, _13884);
    float _22168 = mix(mix(mix(_Globals_.g_fDamageSaturation1, _Globals_.g_fDamageSaturation2, _13915), _Globals_.g_fDamageSaturation3, _21941), _Globals_.g_fDamageSaturation4, _24699);
    float _22171 = mix(mix(mix(_Globals_.g_fDamageNormalEdgeWidth1, _Globals_.g_fDamageNormalEdgeWidth2, _13915), _Globals_.g_fDamageNormalEdgeWidth3, _21941), _Globals_.g_fDamageNormalEdgeWidth4, _24699);
    float _22174 = mix(mix(mix(_Globals_.g_fDetailGrunge1, _Globals_.g_fDetailGrunge2, _13915), _Globals_.g_fDetailGrunge3, _21941), _Globals_.g_fDetailGrunge4, _24699);
    float _22177 = mix(mix(mix(_Globals_.g_fGrimeSaturation1, _Globals_.g_fGrimeSaturation2, _13915), _Globals_.g_fGrimeSaturation3, _21941), _Globals_.g_fGrimeSaturation4, _24699);
    vec2 _22248 = _13810;
    _22248.x = input_0.x * _Globals_.g_fFlipFixup;
    vec4 _18992 = texture(sampler2D(g_tSurface, g_sTrilinearWrap), input_0.xy);
    float _18168 = _18992.x;
    float _14997 = pow(_18168, mix(mix(mix(_Globals_.g_fCurvaturePower1, _Globals_.g_fCurvaturePower2, _13915), _Globals_.g_fCurvaturePower3, _21941), _Globals_.g_fCurvaturePower4, _24699));
    float _20235 = _18992.y;
    float _24805 = _18992.z;
    float _22201 = _18992.w;
    vec2 _22630 = (_13810 * mix(mix(mix(_Globals_.g_fDetailScale1, _Globals_.g_fDetailScale2, _13915), _Globals_.g_fDetailScale3, _21941), _Globals_.g_fDetailScale4, _24699)).xy;
    vec4 _19414 = texture(sampler2D(g_tDetail1, g_sTrilinearWrap), _22630);
    vec2 _14800 = vec2(_Globals_.g_fDetailBlackPoint1);
    vec2 _7443 = _14800 + (_19414.xy * _Globals_.g_fDetailBlackPointCompensation1);
    vec4 _20488 = _19414;
    _20488.x = _7443.x;
    _20488.y = _7443.y;
    vec4 _19415 = texture(sampler2D(g_tDetail2, g_sTrilinearWrap), _22630);
    vec2 _7444 = vec2(_Globals_.g_fDetailBlackPoint2) + (_19415.xy * _Globals_.g_fDetailBlackPointCompensation2);
    vec4 _20489 = _19415;
    _20489.x = _7444.x;
    _20489.y = _7444.y;
    vec4 _19416 = texture(sampler2D(g_tDetail3, g_sTrilinearWrap), _22630);
    vec2 _7445 = vec2(_Globals_.g_fDetailBlackPoint3) + (_19416.xy * _Globals_.g_fDetailBlackPointCompensation3);
    vec4 _20490 = _19416;
    _20490.x = _7445.x;
    _20490.y = _7445.y;
    vec4 _19417 = texture(sampler2D(g_tDetail4, g_sTrilinearWrap), _22630);
    vec2 _7446 = vec2(_Globals_.g_fDetailBlackPoint4) + (_19417.xy * _Globals_.g_fDetailBlackPointCompensation4);
    vec4 _20491 = _19417;
    _20491.x = _7446.x;
    _20491.y = _7446.y;
    vec4 _21174 = vec4(_13915);
    vec4 _14170 = vec4(_21941);
    vec4 _14150 = vec4(_24699);
    vec4 _6543 = mix(mix(mix(_20488.xyzw, _20489.xyzw, _21174), _20490.xyzw, _14170), _20491.xyzw, _14150);
    vec2 _24074 = _14800 + (_6543.xy * _Globals_.g_fDetailBlackPointCompensation1);
    float _10152 = _24074.x;
    float _10579 = _24074.y;
    float _14189 = _6543.z;
    vec2 _23217 = vec2(dot(_22248.xy, _Globals_.g_vPatternTexCoordXform0.xy) + _Globals_.g_vPatternTexCoordXform0.w, dot(_22248.xy, _Globals_.g_vPatternTexCoordXform1.xy) + _Globals_.g_vPatternTexCoordXform1.w) + vec2((((_10579 * 2.0) - 1.0) * 0.0009765625) * _Globals_.g_fPatternDetailInfluence);
    _23217.x = _23217.x * ((input_0.x < 0.0) ? (-1.0) : 1.0);
    float _21717 = 1.0 - _6543.w;
    float _7730 = saturate(((mix(mix(mix(_Globals_.g_fDetailRoughnessContrast1, _Globals_.g_fDetailRoughnessContrast2, _13915), _Globals_.g_fDetailRoughnessContrast3, _21941), _Globals_.g_fDetailRoughnessContrast4, _24699) * (((_21717 * _21717) * 0.85000002384185791015625) + (-0.3499999940395355224609375))) + 0.5) * mix(mix(mix(_Globals_.g_fDetailRoughnessBrightness1, _Globals_.g_fDetailRoughnessBrightness2, _13915), _Globals_.g_fDetailRoughnessBrightness3, _21941), _Globals_.g_fDetailRoughnessBrightness4, _24699));
    float _17411 = 1.0 - _10152;
    vec2 _15902 = vec2(dot(_13810, _Globals_.g_vGrungeTexCoordXform0.xy) + _Globals_.g_vGrungeTexCoordXform0.w, dot(_13810, _Globals_.g_vGrungeTexCoordXform1.xy) + _Globals_.g_vGrungeTexCoordXform1.w).xy;
    vec4 _19338 = texture(sampler2D(g_tGrunge1, g_sTrilinearWrap), _15902);
    vec4 _19339 = texture(sampler2D(g_tGrunge2, g_sTrilinearWrap), _15902);
    vec4 _19340 = texture(sampler2D(g_tGrunge3, g_sTrilinearWrap), _15902);
    vec4 _18453 = texture(sampler2D(g_tGrunge4, g_sTrilinearWrap), _15902);
    vec4 _19739 = mix(mix(mix(_19338.xyzw, _19339.xyzw, _21174), _19340.xyzw, _14170), _18453.xyzw, _14150);
    vec3 _12690 = _19739.xyz;
    float _17907 = dot(_12690, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
    vec4 _22452 = texture(sampler2D(g_tNoise, g_sAniso), (_13810 * 2.0).xy);
    vec4 _19372 = texture(sampler2D(g_tNormal, g_sAniso), input_0.xy);
    float _16000 = _19372.x;
    float _19720 = _19372.y;
    float _16783 = (_16000 + _19720) - 1.00392162799835205078125;
    float _11176 = _16000 - _19720;
    vec3 _17934 = normalize(vec3(vec2(_16783, _11176), (1.0 - abs(_16783)) - abs(_11176)));
    vec4 _19341 = texture(sampler2D(g_tDetailNormal1, g_sTrilinearWrap), _22630);
    vec4 _19342 = texture(sampler2D(g_tDetailNormal2, g_sTrilinearWrap), _22630);
    vec4 _19343 = texture(sampler2D(g_tDetailNormal3, g_sTrilinearWrap), _22630);
    vec4 _18454 = texture(sampler2D(g_tDetailNormal4, g_sTrilinearWrap), _22630);
    vec2 _19777 = mix(mix(mix(_19341.xy, _19342.xy, _8506), _19343.xy, _14169), _18454.xy, _13884);
    float _22845 = _19777.x;
    float _18662 = _19777.y;
    float _16784 = (_22845 + _18662) - 1.00392162799835205078125;
    float _11177 = _22845 - _18662;
    vec3 _17935 = normalize(vec3(vec2(_16784, _11177), (1.0 - abs(_16784)) - abs(_11177)));
    vec4 _19344 = texture(sampler2D(g_tDamageNormal1, g_sTrilinearWrap), _22630);
    vec4 _19345 = texture(sampler2D(g_tDamageNormal2, g_sTrilinearWrap), _22630);
    vec4 _19346 = texture(sampler2D(g_tDamageNormal3, g_sTrilinearWrap), _22630);
    vec4 _18455 = texture(sampler2D(g_tDamageNormal4, g_sTrilinearWrap), _22630);
    vec2 _19778 = mix(mix(mix(_19344.xy, _19345.xy, _8506), _19346.xy, _14169), _18455.xy, _13884);
    float _22846 = _19778.x;
    float _18663 = _19778.y;
    float _16785 = (_22846 + _18663) - 1.00392162799835205078125;
    float _11178 = _22846 - _18663;
    float _16408[8] = float[](0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    int _21567;
    int _13039 = 0;
    for (;;)
    {
        if (!(_13039 < 9))
        {
            break;
        }
        vec4 _22564 = texture(sampler2D(g_tLayerMask, g_sPoint), (_13810 + ((_1329[_13039].xy * 0.0009765625) * _Globals_.g_fColorMaskBlur)).xy);
        float _8268 = _22564.w;
        int _23989;
        int _13040 = 0;
        for (;;)
        {
            if (!(_13040 < 8))
            {
                break;
            }
            if (float(_13040) == floor(_8268 * 8.0))
            {
                _16408[_13040] += _1329[_13039].z;
            }
            _23989 = _13040 + 1;
            _13040 = _23989;
            continue;
        }
        _21567 = _13039 + 1;
        _13039 = _21567;
        continue;
    }
    bool _14874 = _Globals_.g_bPattern != 0;
    vec3 _12724;
    float _13137;
    float _16306;
    float _17117;
    vec3 _17118;
    float _17119;
    float _17120;
    float _17121;
    float _23554;
    SPIRV_CROSS_BRANCH
    if (_14874)
    {
        bool _12885;
        if (_Globals_.g_nPatternMode == 1)
        {
            _12885 = true;
        }
        else
        {
            _12885 = _Globals_.g_nPatternMode == 3;
        }
        float _19287;
        SPIRV_CROSS_BRANCH
        if (_12885)
        {
            _19287 = 1.0;
        }
        else
        {
            _19287 = _16408[_Globals_.g_nPatternReplaceIndex];
        }
        vec4 _21760 = texture(sampler2D(g_tPattern, g_sTrilinearWrap), _23217.xy);
        vec3 _16442[8] = vec3[](_Globals_.g_vColorTint1, _Globals_.g_vColorTint2, _Globals_.g_vColorTint3, _Globals_.g_vColorTint4, _Globals_.g_vColorTint5, _Globals_.g_vColorTint6, _Globals_.g_vColorTint7, _Globals_.g_vColorTint8);
        float _6616;
        float _13136;
        vec3 _13694;
        float _16305;
        vec3 _17114;
        float _17115;
        float _17116;
        SPIRV_CROSS_BRANCH
        if (_Globals_.g_nPatternMode < 2)
        {
            float _13819 = _21760.x;
            float _19482 = _21760.y;
            float _19483 = _21760.z;
            float _9865 = (_13819 + _19482) + _19483;
            float _10776;
            SPIRV_CROSS_BRANCH
            if (_Globals_.g_fPaintThickness > 0.0)
            {
                vec4 _20322 = texture(sampler2D(g_tPattern, g_sTrilinearWrap), _23217.xy, 0.5 + (0.100000001490116119384765625 * _Globals_.g_fPaintThickness));
                _10776 = pow(mix(1.0, (mix(pow(1.0 - _20322.x, _Globals_.g_fPaintShadowPower), 1.0, _13819) * mix(pow(1.0 - _20322.y, _Globals_.g_fPaintShadowPower), 1.0, _19482)) * mix(pow(1.0 - _20322.z, _Globals_.g_fPaintShadowPower), 1.0, _19483), _19287), 0.20000000298023223876953125);
            }
            else
            {
                _10776 = 1.0;
            }
            float _16230 = (saturate(_9865) * _19287) * saturate(_Globals_.g_fPaintThickness - (_14189 * pow(_Globals_.g_fWearProgress, 4.0)));
            float _21772 = _16230 * min(1.0, _Globals_.g_fPaintThickness);
            _13136 = _22201 - (_21772 * _Globals_.g_fPaintDurability);
            _16305 = mix(_10579, 0.5, _16230);
            _17114 = mix(_17935, vec3(0.0, 0.0, 1.0), vec3(_21772));
            _17115 = _9865 * _Globals_.g_fPaintThickness;
            _17116 = _10776;
            _13694 = mix(mix(mix(_16442[_Globals_.g_vPatternPaletteIndices.x - 1], _16442[_Globals_.g_vPatternPaletteIndices.y - 1], vec3(_13819)), _16442[_Globals_.g_vPatternPaletteIndices.z - 1], vec3(_19482)), _16442[_Globals_.g_vPatternPaletteIndices.w - 1], vec3(_19483));
            _6616 = _7730 * mix(1.0, _Globals_.g_fPatternRoughnessBrightness, _21772);
        }
        else
        {
            _13136 = _22201;
            _16305 = _10579;
            _17114 = _17935;
            _17115 = 1.0;
            _17116 = 1.0;
            _13694 = _21760.xyz;
            _6616 = _7730;
        }
        _13137 = mix(_22165, _Globals_.g_fPatternMetalness, _19287);
        _16306 = _13136;
        _17117 = _16305;
        _17118 = _17114;
        _17119 = _19287;
        _17120 = _17115;
        _17121 = _17116;
        _12724 = _13694;
        _23554 = _6616;
    }
    else
    {
        _13137 = _22165;
        _16306 = _22201;
        _17117 = _10579;
        _17118 = _17935;
        _17119 = 1.0;
        _17120 = 1.0;
        _17121 = 1.0;
        _12724 = vec3(0.0);
        _23554 = _7730;
    }
    vec3 _23805 = (((((((_Globals_.g_vColorTint1 * _16408[0]) + (_Globals_.g_vColorTint2 * _16408[1])) + (_Globals_.g_vColorTint3 * _16408[2])) + (_Globals_.g_vColorTint4 * _16408[3])) + (_Globals_.g_vColorTint5 * _16408[4])) + (_Globals_.g_vColorTint6 * _16408[5])) + (_Globals_.g_vColorTint7 * _16408[6])) + (_Globals_.g_vColorTint8 * _16408[7]);
    vec3 _18530 = _23805.xyz;
    vec3 _14602 = _18530 * vec3(0.077399380505084991455078125);
    vec3 _7676 = pow((_18530 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
    float _21354;
    if (_23805.x <= 0.040449999272823333740234375)
    {
        _21354 = _14602.x;
    }
    else
    {
        _21354 = _7676.x;
    }
    float _21355;
    if (_23805.y <= 0.040449999272823333740234375)
    {
        _21355 = _14602.y;
    }
    else
    {
        _21355 = _7676.y;
    }
    float _19456;
    if (_23805.z <= 0.040449999272823333740234375)
    {
        _19456 = _14602.z;
    }
    else
    {
        _19456 = _7676.z;
    }
    vec3 _15471 = vec3(_21354, _21355, _19456);
    vec3 _10597 = _12724.xyz * vec3(0.077399380505084991455078125);
    vec3 _7677 = pow((_12724.xyz * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
    float _21356;
    if (_12724.x <= 0.040449999272823333740234375)
    {
        _21356 = _10597.x;
    }
    else
    {
        _21356 = _7677.x;
    }
    float _21357;
    if (_12724.y <= 0.040449999272823333740234375)
    {
        _21357 = _10597.y;
    }
    else
    {
        _21357 = _7677.y;
    }
    float _20482;
    if (_12724.z <= 0.040449999272823333740234375)
    {
        _20482 = _10597.z;
    }
    else
    {
        _20482 = _7677.z;
    }
    float _11428 = _14997 * _16306;
    float _20765 = mix(mix(mix(_Globals_.g_fCurvatureWearBoost1, _Globals_.g_fCurvatureWearBoost2, _13915), _Globals_.g_fCurvatureWearBoost3, _21941), _Globals_.g_fCurvatureWearBoost4, _24699) * _14997;
    float _12034 = saturate((_11428 * _19739.w) + _20765);
    float _22935 = _7502.x;
    float _11001 = _7502.y;
    float _19034 = smoothstep(_22935, _11001, _12034 * _Globals_.g_fWearProgress);
    float _9410 = 1.0 - _19034;
    float _17292 = saturate(_19034 + ((saturate(smoothstep(_22935, _11001, _12034 * (_Globals_.g_fWearProgress * 4.0))) * _9410) * _14189));
    vec3 _20940;
    SPIRV_CROSS_BRANCH
    if (_14874)
    {
        _20940 = mix(_15471, mix(vec3(_21356, _21357, _20482), _15471, vec3(_17292)), vec3(_17119));
    }
    else
    {
        _20940 = _15471;
    }
    float _23685 = dot(_20940.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
    float _11002 = _17117 * _14997;
    float _11013 = dFdx(_11002);
    float _11026 = dFdy(_11002);
    float _14908 = dFdx(_11002);
    float _23784 = dFdy(_11002);
    float _16103 = _10152 * _14997;
    float _15058 = dFdx(_16103);
    float _11027 = dFdy(_16103);
    float _14909 = dFdx(_16103);
    float _23785 = dFdy(_16103);
    float _22514 = (_18168 + _20235) + _24805;
    float _17067 = dFdx(_22514);
    float _22105 = dFdy(_22514);
    vec3 _18056 = max(_20940, _20940 * (1.0 + (_14997 * 0.5)));
    float _19227 = min(1.0, mix(_17117, _10152, _17292) + ((mix(((1.0 - abs(_11013)) * (1.0 - abs(_11026))) * saturate(abs(_14908) + abs(_23784)), ((1.0 - abs(_15058)) * (1.0 - abs(_11027))) * saturate(abs(_14909) + abs(_23785)), _19034) * (1.0 - saturate(abs(_17067)))) * (1.0 - saturate(abs(_22105)))));
    float _9287 = dot(vec4(_19227).xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
    vec3 _9577 = normalize(max(_18056.xyz, vec3(0.001000000047497451305389404296875)));
    vec3 _10951 = saturate((_9577 * min(_9287 / dot(_9577.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)), (3.0 * _9287) * max(_18056.x, max(_18056.y, _18056.z)))).xyz);
    float _15624 = mix(((_Globals_.g_fWearProgress * _24805) * mix(mix(mix(_Globals_.g_fWearBleaching1, _Globals_.g_fWearBleaching2, _13915), _Globals_.g_fWearBleaching3, _21941), _Globals_.g_fWearBleaching4, _24699)) * mix(_14189, 0.0, saturate(_17120 - 1.0)), mix(mix(mix(_Globals_.g_fDamageBleaching1, _Globals_.g_fDamageBleaching2, _13915), _Globals_.g_fDamageBleaching3, _21941), _Globals_.g_fDamageBleaching4, _24699), _19034);
    vec3 _10558;
    do
    {
        if (_22177 > 0.0)
        {
            vec3 _22572 = normalize(_12690 * _17907).xyz - vec3(0.57700002193450927734375);
            vec3 _7057 = saturate((normalize(_22572) * 2.0) + vec3(1.0)).xyz;
            vec3 _15712 = _7057 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
            _10558 = mix(_12690, _7057 * (_17907 / ((_15712.x + _15712.y) + _15712.z)), vec3(saturate(_22177 * pow(abs(dot(_22572, vec3(0.57700002193450927734375))), 0.20000000298023223876953125))));
            break;
        }
        else
        {
            _10558 = mix(_12690, vec3(_17907), vec3(-_22177));
            break;
        }
        break; // unreachable workaround
    } while(false);
    vec3 _23869 = (_10951 * _12690) * 2.0;
    vec3 _16559 = mix(mix(_10951, _23869, vec3((_22174 * (1.0 + (_Globals_.g_fWearProgress * _22174))) * _9410)), (_10558 * (1.0 + mix(mix(mix(_Globals_.g_fGrimeBrightness1, _Globals_.g_fGrimeBrightness2, _13915), _Globals_.g_fGrimeBrightness3, _21941), _Globals_.g_fGrimeBrightness4, _24699))) * _19227, vec3(_15624));
    vec3 _9452 = _16559.xyz;
    vec3 _10559;
    do
    {
        if (_22168 > 0.0)
        {
            vec3 _22573 = normalize(_20940.xyz * dot(_20940.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))).xyz - vec3(0.57700002193450927734375);
            vec3 _7058 = saturate((normalize(_22573) * 2.0) + vec3(1.0)).xyz;
            vec3 _15713 = _7058 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
            _10559 = mix(_9452, _7058 * (dot(_9452, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)) / ((_15713.x + _15713.y) + _15713.z)), vec3(saturate(_22168 * pow(abs(dot(_22573, vec3(0.57700002193450927734375))), 0.20000000298023223876953125))));
            break;
        }
        else
        {
            _10559 = mix(_9452, vec3(dot(_16559.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), vec3(-_22168));
            break;
        }
        break; // unreachable workaround
    } while(false);
    vec3 _19489 = vec3(_19034);
    vec3 _6932 = mix(_16559, _10559 * (1.0 + mix(mix(mix(_Globals_.g_fDamageBrightness1, _Globals_.g_fDamageBrightness2, _13915), _Globals_.g_fDamageBrightness3, _21941), _Globals_.g_fDamageBrightness4, _24699)), _19489);
    vec3 _12529 = mix(_6932, _12690 * _6932, vec3((smoothstep(0.449999988079071044921875, 0.75, (1.0 - ((_18168 * _20235) * _20235)) * _Globals_.g_fWearProgress) * (1.0 - (_23685 * 0.5))) * mix(mix(mix(_Globals_.g_fGrungeMax1, _Globals_.g_fGrungeMax2, _13915), _Globals_.g_fGrungeMax3, _21941), _Globals_.g_fGrungeMax4, _24699)));
    vec3 _7286 = _12529.xyz;
    float _15036 = dot(_7286, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)) * 0.5;
    float _9533 = _12529.x;
    float _16877 = _12529.y;
    bool _12886;
    if (_9533 > _16877)
    {
        _12886 = _9533 > _12529.z;
    }
    else
    {
        _12886 = false;
    }
    vec3 _10970;
    vec3 _12555;
    if (_12886)
    {
        _10970 = vec3(0.60000002384185791015625, 1.0, 0.0) + _12529.zxy;
        _12555 = vec3(0.20000000298023223876953125, 0.60000002384185791015625, 1.0) + _12529.zyx;
    }
    else
    {
        bool _12887;
        if (_16877 > _9533)
        {
            _12887 = _16877 > _12529.z;
        }
        else
        {
            _12887 = false;
        }
        vec3 _13212;
        vec3 _15670;
        if (_12887)
        {
            _13212 = vec3(0.60000002384185791015625, 1.0, 0.0) + _12529.zxy;
            _15670 = vec3(0.20000000298023223876953125, 0.60000002384185791015625, 1.0) + _12529.yzx;
        }
        else
        {
            _13212 = vec3(0.60000002384185791015625, 1.0, 0.0);
            _15670 = vec3(0.20000000298023223876953125, 0.60000002384185791015625, 1.0);
        }
        _10970 = _13212;
        _12555 = _15670;
    }
    bool _21112;
    float _6982 = (pow(1.0 - _23685, 3.5) * 0.300000011920928955078125) + ((length(_12529 - vec3(_15036)) * 0.1500000059604644775390625) + 0.0500000007450580596923828125);
    float _22476 = pow(_20235, 8.0);
    vec3 _11286;
    do
    {
        _21112 = _6982 > 0.0;
        if (_21112)
        {
            vec3 _22574 = normalize(_12555.xyz * dot(_12555.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))).xyz - vec3(0.57700002193450927734375);
            vec3 _7059 = saturate((normalize(_22574) * 2.0) + vec3(1.0)).xyz;
            vec3 _15714 = _7059 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
            _11286 = mix(_7286, _7059 * (_15036 / ((_15714.x + _15714.y) + _15714.z)), vec3(saturate(_6982 * pow(abs(dot(_22574, vec3(0.57700002193450927734375))), 0.20000000298023223876953125))));
            break;
        }
        else
        {
            _11286 = mix(_7286, vec3(dot(_12529.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), vec3(-_6982));
            break;
        }
        break; // unreachable workaround
    } while(false);
    vec3 _16611;
    do
    {
        if (_21112)
        {
            vec3 _22575 = normalize(_10970.xyz * dot(_10970.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))).xyz - vec3(0.57700002193450927734375);
            vec3 _7060 = saturate((normalize(_22575) * 2.0) + vec3(1.0)).xyz;
            vec3 _15715 = _7060 * vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125);
            _16611 = mix(_7286, _7060 * (_15036 / ((_15715.x + _15715.y) + _15715.z)), vec3(saturate(_6982 * pow(abs(dot(_22575, vec3(0.57700002193450927734375))), 0.20000000298023223876953125))));
            break;
        }
        else
        {
            _16611 = mix(_7286, vec3(dot(_12529.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), vec3(-_6982));
            break;
        }
        break; // unreachable workaround
    } while(false);
    vec3 _17278 = saturate(mix(mix(_11286, _16611, vec3(saturate(_22476 * _22452.x))), _12529, vec3(saturate(_22452.z * (0.5 + (_22476 * 0.5))))));
    vec2 _13138;
    float _16324;
    _13138 = vec2(0.0);
    _16324 = 0.0;
    vec2 _10648;
    float _14733;
    int _18386;
    int _17017 = 0;
    for (;;)
    {
        if (!(_17017 < 4))
        {
            break;
        }
        vec2 _10548 = (_15902 + (((_592[_17017] * 0.0009765625) * _22171) * (1.0 + _17120))).xy;
        float _24694 = _19034 - smoothstep(_22935, _11001, saturate((mix(mix(mix(texture(sampler2D(g_tGrunge1, g_sTrilinearWrap), _10548).w, texture(sampler2D(g_tGrunge2, g_sTrilinearWrap), _10548).w, _13915), texture(sampler2D(g_tGrunge3, g_sTrilinearWrap), _10548).w, _21941), texture(sampler2D(g_tGrunge4, g_sTrilinearWrap), _10548).w, _24699) * _11428) + _20765) * _Globals_.g_fWearProgress);
        _10648 = _13138.xy - (_592[_17017] * _24694);
        _14733 = _16324 + abs(_24694);
        _18386 = _17017 + 1;
        _13138 = _10648;
        _16324 = _14733;
        _17017 = _18386;
        continue;
    }
    float _7827 = _16324 * 0.25;
    vec2 _11392 = _13138.xy * (_22171 * 0.25);
    vec2 _23775;
    SPIRV_CROSS_BRANCH
    if (_Globals_.g_nPatternMode < 2)
    {
        float _11401 = (0.0009765625 * _Globals_.g_fPaintThickness) * (1.0 - _7827);
        vec2 _13155;
        _13155 = vec2(0.0);
        vec2 _11588;
        int _11797;
        int _16208 = 0;
        for (;;)
        {
            if (!(_16208 < 4))
            {
                break;
            }
            vec4 _19373 = texture(sampler2D(g_tPattern, g_sTrilinearWrap), (_23217.xy + ((_592[_16208] * _11401) * 2.0)).xy);
            float _16002 = _19373.x;
            float _18770 = _19373.y;
            float _14681 = _19373.z;
            _11588 = _13155.xy - ((((_592[_16208] * (_17120 - (((_16002 + _18770) + _14681) * _Globals_.g_fPaintThickness))).xy * (saturate(_9410) * _17119)).xy * (1.0 - min(min(_16002, _14681 - min(_16002, _18770)), _18770 - _16002))) * 0.5);
            _11797 = _16208 + 1;
            _13155 = _11588;
            _16208 = _11797;
            continue;
        }
        float _6962 = dot(_13155.xy, _Globals_.g_vPatternTexRotationXform0.xy);
        vec2 _8112 = vec2(_6962, dot(_13155.xy, _Globals_.g_vPatternTexRotationXform1.xy));
        float _10826 = _6962 * _Globals_.g_fFlipFixup;
        _8112.x = _10826;
        vec2 _12501;
        if (input_0.x > 0.0)
        {
            vec2 _21219 = _8112;
            _21219.x = _10826 * (-1.0);
            _12501 = _21219;
        }
        else
        {
            _12501 = _8112;
        }
        _23775 = _12501;
    }
    else
    {
        _23775 = vec2(0.0);
    }
    vec3 _24364 = mix(_17118, normalize(vec3(vec2(_16785, _11178), (1.0 - abs(_16785)) - abs(_11178))), _19489);
    vec2 _22606 = _24364.xy * mix(mix(mix(_Globals_.g_fDetailNormalContrast1, _Globals_.g_fDetailNormalContrast2, _13915), _Globals_.g_fDetailNormalContrast3, _21941), _Globals_.g_fDetailNormalContrast4, _24699);
    vec3 _8673;
    _8673.x = _22606.x;
    _8673.y = _22606.y;
    vec3 _10041 = normalize(vec3(((_17934.xy + _8673.xy) - vec2(-dot(_11392, _Globals_.g_vGrungeTexRotationXform0.xy), dot(_11392, _Globals_.g_vGrungeTexRotationXform1.xy)).xy) + _23775.xy, _17934.z));
    float _19526 = mix(mix(_13137, mix(mix(mix(_Globals_.g_fDamageMetalness1, _Globals_.g_fDamageMetalness2, _13915), _Globals_.g_fDamageMetalness3, _21941), _Globals_.g_fDamageMetalness4, _24699), _19034), mix(mix(mix(_Globals_.g_fDamageEdgeMetalness1, _Globals_.g_fDamageEdgeMetalness2, _13915), _Globals_.g_fDamageEdgeMetalness3, _21941), _Globals_.g_fDamageEdgeMetalness4, _24699), _7827);
    float _11543 = mix(mix(mix(mix(_Globals_.g_fDetailCloth1, _Globals_.g_fDetailCloth2, _13915), _Globals_.g_fDetailCloth3, _21941), _Globals_.g_fDetailCloth4, _24699), mix(mix(mix(_Globals_.g_fDamageCloth1, _Globals_.g_fDamageCloth2, _13915), _Globals_.g_fDamageCloth3, _21941), _Globals_.g_fDamageCloth4, _24699), max(_17292, _7827)) * (1.0 - _19526);
    vec2 _22792 = mix(mix(vec2(1.0) * mix(min(1.0, _23554), (1.0 - _17907) + mix(mix(mix(_Globals_.g_fGrungeRoughnessBrightness1, _Globals_.g_fGrungeRoughnessBrightness2, _13915), _Globals_.g_fGrungeRoughnessBrightness3, _21941), _Globals_.g_fGrungeRoughnessBrightness4, _24699), _15624), vec2(saturate(((mix(mix(mix(_Globals_.g_fDamageRoughnessContrast1, _Globals_.g_fDamageRoughnessContrast2, _13915), _Globals_.g_fDamageRoughnessContrast3, _21941), _Globals_.g_fDamageRoughnessContrast4, _24699) * (((_17411 * _17411) * 0.85000002384185791015625) + (-0.3499999940395355224609375))) + 0.5) * mix(mix(mix(_Globals_.g_fDamageRoughnessBrightness1, _Globals_.g_fDamageRoughnessBrightness2, _13915), _Globals_.g_fDamageRoughnessBrightness3, _21941), _Globals_.g_fDamageRoughnessBrightness4, _24699))), vec2(_19034)).xy, vec2(mix(mix(mix(_Globals_.g_fDamageEdgeRoughness1, _Globals_.g_fDamageEdgeRoughness2, _13915), _Globals_.g_fDamageEdgeRoughness3, _21941), _Globals_.g_fDamageEdgeRoughness4, _24699)), vec2(_7827));
    vec3 _7958 = normalize(max(vec3(0.0003000000142492353916168212890625), _17278.xyz));
    vec3 _23898 = mix(_Globals_.g_vTextileAlbedoLevels.xyz, _Globals_.g_vMetallicTextileAlbedoLevels.xyz, vec3(_19526));
    float _22205 = ((_20235 * pow(_24364.z, 0.20000000298023223876953125)) * (1.0 - (_16324 * 0.0500000007450580596923828125))) * mix(_17121, 1.0, _19034);
    _10041.y = -_10041.y;
    vec3 _23712 = normalize(_10041.xyz);
    float _21931 = _22792.x;
    vec4 _23727;
    SPIRV_CROSS_BRANCH
    if (_Globals_.g_nOutputMode == 0)
    {
        _23727 = vec4(mix(_17278.xyz, ((_7958.xyz * mix(min(_23898.x, dot(mix(_10951, _23869, vec3(_22174)).xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), _23898.z, saturate(pow(max(_17278.x, max(_17278.y, _17278.z)), _23898.y)))) / vec3(max(_7958.x, max(_7958.y, _7958.z)))).xyz, vec3(_Globals_.g_fWearProgress)).xyz, 1.0);
    }
    else
    {
        vec4 _12504;
        if (_Globals_.g_nOutputMode == 1)
        {
            float _8704 = _23712.y * (-1.0);
            vec3 _8007 = _23712;
            _8007.y = _8704;
            vec3 _16929 = _8007.xyz / vec3((abs(_23712.x) + abs(_8704)) + abs(_23712.z));
            float _10674 = _16929.x;
            float _23725 = _16929.y;
            vec2 _21979 = (vec2(_10674 + _23725, _10674 - _23725) * 0.5) + vec2(0.5);
            vec3 _16637 = vec3(_21979.xy, _21931).xyz;
            vec3 _10601 = _16637 * vec3(0.077399380505084991455078125);
            vec3 _7679 = pow((_16637 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
            float _21358;
            if (_21979.x <= 0.040449999272823333740234375)
            {
                _21358 = _10601.x;
            }
            else
            {
                _21358 = _7679.x;
            }
            float _23037;
            if (_21979.y <= 0.040449999272823333740234375)
            {
                _23037 = _10601.y;
            }
            else
            {
                _23037 = _7679.y;
            }
            float _19478;
            if (_21931 <= 0.040449999272823333740234375)
            {
                _19478 = _10601.z;
            }
            else
            {
                _19478 = _7679.z;
            }
            _12504 = vec4(vec3(_21358, _23037, _19478), 1.0);
        }
        else
        {
            vec4 _12503;
            if (_Globals_.g_nOutputMode == 2)
            {
                vec3 _20866 = vec3(0.0, _19526, _11543).xyz;
                vec3 _10600 = _20866 * vec3(0.077399380505084991455078125);
                vec3 _7678 = pow((_20866 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                float _23036;
                if (_19526 <= 0.040449999272823333740234375)
                {
                    _23036 = _10600.y;
                }
                else
                {
                    _23036 = _7678.y;
                }
                float _19476;
                if (_11543 <= 0.040449999272823333740234375)
                {
                    _19476 = _10600.z;
                }
                else
                {
                    _19476 = _7678.z;
                }
                _12503 = vec4(vec3(_10600.x, _23036, _19476), 1.0);
            }
            else
            {
                vec4 _12502;
                if (_Globals_.g_nOutputMode == 3)
                {
                    vec3 _20865 = vec3(_22205).xyz;
                    vec3 _10599 = _20865 * vec3(0.077399380505084991455078125);
                    vec3 _9358 = pow((_20865 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                    bool _17062 = _22205 <= 0.040449999272823333740234375;
                    float _12888;
                    if (_17062)
                    {
                        _12888 = _10599.x;
                    }
                    else
                    {
                        _12888 = _9358.x;
                    }
                    float _12889;
                    if (_17062)
                    {
                        _12889 = _10599.y;
                    }
                    else
                    {
                        _12889 = _9358.y;
                    }
                    float _19475;
                    if (_17062)
                    {
                        _19475 = _10599.z;
                    }
                    else
                    {
                        _19475 = _9358.z;
                    }
                    _12502 = vec4(vec3(_12888, _12889, _19475), 1.0);
                }
                else
                {
                    vec3 _16636 = vec3(_22792.xy, 0.0).xyz;
                    vec3 _10598 = _16636 * vec3(0.077399380505084991455078125);
                    vec3 _9357 = pow((_16636 * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
                    float _23035;
                    if (_21931 <= 0.040449999272823333740234375)
                    {
                        _23035 = _10598.x;
                    }
                    else
                    {
                        _23035 = _9357.x;
                    }
                    float _19302;
                    if (_22792.y <= 0.040449999272823333740234375)
                    {
                        _19302 = _10598.y;
                    }
                    else
                    {
                        _19302 = _9357.y;
                    }
                    _12502 = vec4(vec3(_23035, _19302, _10598.z), 1.0);
                }
                _12503 = _12502;
            }
            _12504 = _12503;
        }
        _23727 = _12504;
    }
    vec4 _6805;
    SPIRV_CROSS_BRANCH
    if (_11543 < 0.0)
    {
        vec4 _18969 = _23727;
        _18969.w = _Globals_.g_flSheenScale;
        _6805 = _18969;
    }
    else
    {
        _6805 = _23727;
    }
    output_0 = _6805;
}


