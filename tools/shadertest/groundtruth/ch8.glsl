// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 3 (name: g_vColor0) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (14028 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup
// Static combos: S_PAINT_STYLE=8, S_OVERRIDE_NORMAL, S_PEARLESCENCE_MASK, S_SEPARATE_CHANNEL_INPUTS, S_CASE_HARDENING

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

vec4 _2;

struct _2707
{
    int bRoughnessMode;
    int g_bPearlescenceMaskUsesPatternUVs;
    float g_fWearSoftness;
    vec3 g_vColor0;
    vec3 g_vColor1;
    vec3 g_vColor2;
    vec3 g_vColor3;
    float g_flColorBrightness;
    int g_nColorAdjustmentMode;
    float g_flPaintRoughness;
    float g_flPearlescentScale;
    int g_bPearlescentOnMetallicOnly;
    float g_flPaintMetalness;
    float g_flWearAmount;
    float g_flCaseHardeningPatternInfluence;
    float g_flCaseHardeningGeometricInfluence;
    float g_flCaseHardeningRampOffset;
    vec3 g_vPaintAlbedoLevels;
    vec3 g_vMetallicPaintAlbedoLevels;
};

layout(set = 1) uniform _2707 _Globals_;

layout(set = 1, binding = 30) uniform texture2D g_tAmbientOcclusion;
layout(set = 1, binding = 23) uniform sampler g_sTrilinearClamp;
layout(set = 1, binding = 31) uniform texture2D g_tMasks;
layout(set = 1, binding = 40) uniform texture2D g_tWear;
layout(set = 1, binding = 22) uniform sampler g_sTrilinearWrap;
layout(set = 1, binding = 39) uniform texture2D g_tPattern;
layout(set = 1, binding = 27) uniform sampler AddressU_dynamic_AddressV_dynamic;
layout(set = 1, binding = 36) uniform texture2D g_tNormal;
layout(set = 1, binding = 42) uniform texture2D g_tCaseHardeningColorRamp;
layout(set = 1, binding = 41) uniform texture2D g_tGrunge;
layout(set = 1, binding = 35) uniform texture2D g_tMetalness;
layout(set = 1, binding = 37) uniform texture2D g_tPearlescenceMask;
layout(set = 1, binding = 34) uniform texture2D g_tColor;
layout(set = 1, binding = 38) uniform texture2D g_tGlitterNormal;

layout(location = 1) in vec4 input_0;
layout(location = 2) in vec4 input_1;
layout(location = 0) out vec4 output_0;

void main()
{
    vec4 _18087 = texture(sampler2D(g_tAmbientOcclusion, g_sTrilinearClamp), input_0.xy);
    float _11142 = pow(_18087.x, 1.5);
    float _4306 = _11142 * 0.959999978542327880859375;
    float _5542 = _18087.y;
    vec4 _19372 = texture(sampler2D(g_tMasks, g_sTrilinearClamp), input_0.xy);
    float _17150 = _19372.x;
    float _13255 = 1.0 - _17150;
    vec4 _19334 = texture(sampler2D(g_tWear, g_sTrilinearWrap), input_1.xy);
    float _5744 = _19334.x;
    vec4 _22452 = texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), input_0.zw);
    vec4 _9448 = texture(sampler2D(g_tNormal, g_sTrilinearWrap), input_0.xy);
    vec4 _19604 = smoothstep(vec4(0.85000002384185791015625), vec4(0.20000000298023223876953125), min(_9448, vec4(1.0) - _9448));
    float _4409 = mix(0.5, pow(_4306, 0.85000002384185791015625), _Globals_.g_flCaseHardeningGeometricInfluence) * mix(1.0, _5542 * (min(_19604.x, _19604.y) * 2.0), _Globals_.g_flCaseHardeningGeometricInfluence);
    float _6306 = _4409 * 2.0;
    float _3407 = max(_22452.y * _Globals_.g_flCaseHardeningPatternInfluence, ((1.0 - _5542) * 0.20000000298023223876953125) * _Globals_.g_flCaseHardeningGeometricInfluence) + _Globals_.g_flCaseHardeningRampOffset;
    vec4 _20284 = texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), (input_0.zw + vec2(0.00048828125, -0.00048828125)).xy);
    vec4 _20633 = texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_6306, _4409 + _20284.x, _Globals_.g_flCaseHardeningPatternInfluence), _3407));
    float _7414 = _19372.y;
    vec4 _6449 = mix(_22452.xyzw, (((((texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_6306, _4409 + _22452.x, _Globals_.g_flCaseHardeningPatternInfluence), _3407)).xyzw + texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_6306, _4409 + texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), (input_0.zw + vec2(0.00048828125)).xy).x, _Globals_.g_flCaseHardeningPatternInfluence), _3407)).xyzw).xyzw + texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_6306, _4409 + texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), (input_0.zw + vec2(-0.00048828125)).xy).x, _Globals_.g_flCaseHardeningPatternInfluence), _3407)).xyzw).xyzw + texture(sampler2D(g_tCaseHardeningColorRamp, g_sTrilinearClamp), vec2(mix(_6306, _4409 + texture(sampler2D(g_tPattern, AddressU_dynamic_AddressV_dynamic), (input_0.zw + vec2(-0.00048828125, 0.00048828125)).xy).x, _Globals_.g_flCaseHardeningPatternInfluence), _3407)).xyzw).xyzw + _20633.xyzw).xyzw * 0.20000000298023223876953125).xyzw, vec4(_7414));
    float _23781 = _6449.w;
    float _16231 = mix(1.0, _23781, _7414);
    float _17710 = max(0.0, smoothstep(0.0, 0.5, _23781));
    float _10193 = (((min(_18087.w, _13255) + (_5744 * mix(smoothstep(0.0, 0.7200000286102294921875, pow(_4306, 1.2999999523162841796875)), smoothstep(0.0, 0.4000000059604644775390625, _4306), pow(_Globals_.g_flWearAmount, 1.2000000476837158203125)))) * ((_Globals_.g_flWearAmount * 6.0) + 1.0)) + (smoothstep(0.5, 0.60000002384185791015625, _23781) * smoothstep(1.0, 0.89999997615814208984375, _23781))) * _17710;
    float _4693 = _Globals_.g_fWearSoftness * _17710;
    bool _18318 = _17150 > 0.9900000095367431640625;
    float _6760 = mix(smoothstep(0.579999983310699462890625 - _4693, 0.680000007152557373046875 + _4693, _10193), _10193, float(_18318));
    vec4 _19373 = texture(sampler2D(g_tGrunge, g_sTrilinearWrap), input_1.zw);
    float _8353 = smoothstep(0.20000000298023223876953125, 0.60000002384185791015625, ((_5744 * _5542) * (_5744 * smoothstep(0.20000000298023223876953125, 0.300000011920928955078125, _4306))) * _Globals_.g_flWearAmount);
    float _6896 = smoothstep(0.5 * _Globals_.g_flWearAmount, 0.0, clamp(((_11142 * 11.51999950408935546875) * _5542) - ((_Globals_.g_flWearAmount * clamp((_19373.x * _19373.y) * _19373.z, 0.0, 1.0)) * 2.0), 0.0, 1.0)) * _Globals_.g_flWearAmount;
    float _5609 = 1.0 - _6896;
    vec4 _8001 = max(mix(vec4(1.0), _19373, vec4((pow(1.0 - _4306, 4.0) * 0.25) + (0.75 * _Globals_.g_flWearAmount))), vec4(saturate(_8353 * 2.0)));
    float _10247;
    vec4 _11711;
    if (_Globals_.bRoughnessMode != 0)
    {
        vec4 _20322 = texture(sampler2D(g_tMetalness, g_sTrilinearClamp), input_0.xy);
        float _6933 = 1.0 - _6760;
        float _17973 = mix(_Globals_.g_flPaintRoughness, _Globals_.g_flPaintRoughness * (1.0 - (0.25 * dot(_6449.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)))), _7414);
        float _24500 = 1.0 - min(1.0, _23781 * 2.0);
        float _9781 = dot(_8001.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
        float _23988 = _8001.w;
        float _19555 = (1.0 - _23988) * _Globals_.g_flWearAmount;
        float _20709 = clamp((((mix(_17973, mix(((_24500 * _24500) * 0.85000002384185791015625) + 0.1500000059604644775390625, _17973, float(_23781 >= 0.5)), _17150) * mix(1.0, 0.89999997615814208984375, _8353)) + (((1.0 - _9781) * _Globals_.g_flWearAmount) * 0.0500000007450580596923828125)) + ((_6896 * 0.1500000059604644775390625) * _Globals_.g_flWearAmount)) + (_19555 * 0.1500000059604644775390625), 0.0, 1.0);
        float _14223 = mix(_16231 * mix(1.0, pow((_5609 * _23988) * _9781, 0.5), _Globals_.g_flWearAmount), 1.0, _8353);
        vec4 _13436;
        _13436.x = mix(_20322.x, mix(min(1.0, _20709 + ((_19555 * _Globals_.g_flWearAmount) * 0.5)), _20709, _17150), _18318 ? 1.0 : max(0.0, _6933));
        _13436.y = mix(mix(_Globals_.g_flPaintMetalness, _20322.y, _6760), _14223, _17150);
        vec4 _21709;
        SPIRV_CROSS_BRANCH
        if (_Globals_.g_bPearlescenceMaskUsesPatternUVs != 0)
        {
            vec4 _18602 = _13436;
            _18602.z = _6933 * texture(sampler2D(g_tPearlescenceMask, g_sTrilinearWrap), input_0.zw).x;
            _21709 = _18602;
        }
        else
        {
            float _24237 = _6933 * texture(sampler2D(g_tPearlescenceMask, g_sTrilinearWrap), input_0.xy).x;
            vec4 _9184 = _13436;
            _9184.z = _24237 * _24237;
            _21709 = _9184;
        }
        vec4 _21710;
        if (_Globals_.g_bPearlescentOnMetallicOnly != 0)
        {
            vec4 _18603 = _21709;
            _18603.z = _21709.z * _17150;
            _21710 = _18603;
        }
        else
        {
            _21710 = _21709;
        }
        vec3 _18043 = _21710.xyz * vec3(0.077399380505084991455078125);
        vec3 _7676 = pow((_21710.xyz * vec3(0.947867333889007568359375)) + vec3(0.052132703363895416259765625), vec3(2.400000095367431640625));
        float _21354;
        if (_21710.x <= 0.040449999272823333740234375)
        {
            _21354 = _18043.x;
        }
        else
        {
            _21354 = _7676.x;
        }
        float _21355;
        if (_21710.y <= 0.040449999272823333740234375)
        {
            _21355 = _18043.y;
        }
        else
        {
            _21355 = _7676.y;
        }
        float _22686;
        if (_21710.z <= 0.040449999272823333740234375)
        {
            _22686 = _18043.z;
        }
        else
        {
            _22686 = _7676.z;
        }
        _11711 = vec4(_21354, _21355, _22686, min(1.0, _Globals_.g_flPearlescentScale));
        _10247 = _14223;
    }
    else
    {
        _11711 = vec4(input_0.xy, 0.0, 1.0);
        _10247 = _16231;
    }
    vec4 _22401;
    if (_Globals_.bRoughnessMode == 0)
    {
        vec3 _22868 = vec3(_Globals_.g_flWearAmount);
        vec3 _21096 = _6449.xyz;
        vec3 _15472 = mix(_21096, _21096 * _Globals_.g_flColorBrightness, vec3(max(_17150, float(_Globals_.g_nColorAdjustmentMode))));
        vec4 _17842;
        _17842.x = _15472.x;
        _17842.y = _15472.y;
        _17842.z = _15472.z;
        vec3 _15176 = vec3(_17150);
        vec3 _21103 = mix(_17842.xyz, mix(mix(mix(_Globals_.g_vColor1, _Globals_.g_vColor3, vec3(pow(_Globals_.g_flWearAmount, 0.5))), mix(_Globals_.g_vColor1, _Globals_.g_vColor2, _22868), vec3(_5609)) * _17842.xyz, _Globals_.g_vColor0 * dot(_17842.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)), vec3(_8353)), _15176).xyz * _8001.xyz;
        vec3 _21271 = normalize(max(vec3(0.0003000000142492353916168212890625), _21103.xyz));
        vec3 _23898 = mix(_Globals_.g_vPaintAlbedoLevels.xyz, _Globals_.g_vMetallicPaintAlbedoLevels.xyz, vec3(mix(_Globals_.g_flPaintMetalness, _10247, _17150)));
        vec3 _25172 = mix(mix(_21103, ((_21271.xyz * mix(min(_23898.x, dot(mix(_17842.xyz, _17842.xyz * _Globals_.g_vColor1, _15176).xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))), _23898.z, clamp(pow(max(_21103.x, max(_21103.y, _21103.z)), _23898.y), 0.0, 1.0))) / vec3(max(_21271.x, max(_21271.y, _21271.z)))).xyz, _22868), texture(sampler2D(g_tColor, g_sTrilinearClamp), input_0.xy).xyz, vec3(_6760 * _13255));
        _22401 = vec4(_25172, 1.0);
    }
    else
    {
        _22401 = _11711;
    }
    vec4 _21329 = texture(sampler2D(g_tNormal, g_sTrilinearWrap), input_0.xy);
    vec4 _22402;
    if (_21329.w < 0.0)
    {
        vec4 _23136 = _22401;
        _23136.x = _21329.x;
        _23136.y = _21329.y;
        _23136.z = _21329.z;
        _22402 = _23136;
    }
    else
    {
        _22402 = _22401;
    }
    vec4 _3401 = texture(sampler2D(g_tGlitterNormal, g_sTrilinearWrap), input_0.xy);
    vec4 _6805;
    if (_3401.w < 0.0)
    {
        vec4 _23137 = _22402;
        _23137.x = _3401.x;
        _23137.y = _3401.y;
        _23137.z = _3401.z;
        _6805 = _23137;
    }
    else
    {
        _6805 = _22402;
    }
    output_0 = _6805;
}


