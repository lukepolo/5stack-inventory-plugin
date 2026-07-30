// SPIR-V reflection failed for backend HLSL:
// cbuffer ID 5618 (name: _Globals_), member index 21 (name: g_flSheenTintColor) cannot be expressed with either HLSL packing layout or packoffset.
//
// Re-attempting reflection with the GLSL backend.

// Source 2 Viewer 19.2.0.0 - https://valveresourceformat.github.io
// SPIR-V source (97160 bytes), GLSL reflection with SPIRV-Cross by KhronosGroup
// Static combos: S_PATCHES

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
#extension GL_KHR_shader_subgroup_arithmetic : require
#extension GL_EXT_samplerless_texture_functions : require

struct _630
{
    vec4 _m0[3];
};

struct _291
{
    vec4 _m0[4];
};

struct _1753
{
    mat4x3 _m0;
    vec3 _m1;
    uint _m2;
    vec3 _m3;
    uint _m4;
    vec4 _m5;
    vec3 _m6;
    vec4 _m7;
};

struct _631
{
    _1753 _m0[128];
};

struct _1343
{
    mat4x3 _m0;
    vec3 _m1;
    vec3 _m2;
    vec3 _m3;
    uint _m4;
};

struct _2218
{
    _1343 _m0[128];
};

struct _2253
{
    mat4 _m0[4];
};

struct _200
{
    mat4 _m0;
    mat4 _m1;
    vec4 _m2;
    vec4 _m3;
    vec4 _m4;
    vec4 _m5;
    vec3 _m6;
    uint _m7;
    vec4 _m8;
    vec4 _m9;
    vec4 _m10;
    float _m11;
    float _m12;
    uint _m13;
    int _m14;
    mat4x3 _m15;
    vec4 _m16;
    vec4 _m17;
    vec4 _m18;
    vec4 _m19;
    vec4 _m20;
    vec3 _m21;
    float _m22;
    mat4 _m23;
};

struct _1624
{
    mat4x3 _m0;
    vec3 _m1;
    vec3 _m2;
    uint _m3;
    vec4 _m4;
    vec3 _m5;
    vec3 _m6;
};

struct _2029
{
    _1624 _m0[400];
};

vec4 _4;
vec3 _5;

struct _2997
{
    int g_bClothShading;
    int g_bDistanceContrastAdjustment;
    float g_fDistanceContrastExposure;
    float g_flFogModificationAmount;
    uint g_sAniso;
    uint g_sBilinearClamp;
    uint g_sTrilinearWrap;
    uint g_sTrilinearClamp;
    uint g_sPointClamp;
    uint g_sUserConfig;
    uint g_sUserConfigAllowGlobalMipBias;
    uint g_sCookieSampler;
    uint g_tShadowDepthBufferCmpSampler;
    int g_bFogEnabled;
    int g_bDontFlipBackfaceNormals;
    int g_bRenderBackfaceNormals;
    float g_flReflectance;
    uint g_tColor;
    uint g_tNormal;
    uint g_tAmbientOcclusion;
    float g_flSheenScale;
    vec3 g_flSheenTintColor;
    uint g_tMetalness;
    float g_flRainExposureToSkyWetness;
    float g_flRainExposureLocalTimer;
    vec3 g_vAvgAlbedo;
    float g_flWaterHeightMinOs;
    float g_flWaterHeightMaxOs;
    vec3 g_vLastDecalPosOs;
    vec3 g_vLastDecalNrmOs;
    float g_flLastDecalTime;
    float g_flSpawnInvulnerability;
    vec3 g_cInvulnerabilityColor;
    uint g_sAnisoClampPatchSampler;
    int g_bEnablePatch0;
    uint g_tPatch0;
    uint g_tPatch0Backing;
    vec2 g_vPatch0Offset;
    float g_flPatch0Scale;
    float g_flPatch0Squash;
    float g_flPatch0Rotation;
    float g_flPatch0BackingScale;
    float g_flPatch0HighlightTime;
    int g_bEnablePatch1;
    uint g_tPatch1;
    uint g_tPatch1Backing;
    vec2 g_vPatch1Offset;
    float g_flPatch1Scale;
    float g_flPatch1Squash;
    float g_flPatch1Rotation;
    float g_flPatch1BackingScale;
    float g_flPatch1HighlightTime;
    int g_bEnablePatch2;
    uint g_tPatch2;
    uint g_tPatch2Backing;
    vec2 g_vPatch2Offset;
    float g_flPatch2Scale;
    float g_flPatch2Squash;
    float g_flPatch2Rotation;
    float g_flPatch2BackingScale;
    float g_flPatch2HighlightTime;
};

layout(set = 1) uniform _2997 _Globals_;

struct _2776
{
    ivec4 _m0;
    ivec4 _m1;
    ivec4 _m2;
    ivec4 _m3;
    uint _m4;
    uint _m5;
    uint _m6;
    uint _m7;
    uint _m8;
    uint _m9;
    uint _m10;
    uint _m11;
    float _m12;
    float _m13;
    ivec2 _m14;
    mat4 _m15;
    vec2 _m16;
    float _m17;
    vec4 _m18;
    vec4 _m19;
    vec4 _m20;
    vec4 _m21;
    vec4 _m22;
    vec4 _m23;
    mat4 _m24;
    vec4 _m25;
    vec4 _m26;
    vec4 _m27;
    float _m28;
    float _m29;
    float _m30;
    vec4 _m31;
};

layout(set = 1) uniform _2776 PerViewConstantBufferCsgo_t;

struct _1732
{
    float _m0;
    float _m1;
    vec2 _m2;
    vec2 _m3;
    vec4 _m4;
    float _m5;
    vec4 _m6;
    vec3 _m7;
    vec3 _m8;
};

layout(set = 1) uniform _1732 PerViewConstantBuffer_t;

struct _708
{
    vec4 _m0;
    vec4 _m1;
    vec4 _m2;
    vec4 _m3;
    vec4 _m4;
    _630 _m5;
    _291 _m6;
    vec4 _m7;
    vec4 _m8;
    vec4 _m9;
    uvec4 _m10;
    uvec4 _m11;
    uvec4 _m12;
    uvec4 _m13;
    vec4 _m14;
    vec4 _m15;
    _631 _m16;
    _2218 _m17;
    vec4 _m18;
    vec4 _m19;
    int _m20;
    float _m21;
    vec4 _m22;
    float _m23;
    float _m24;
    float _m25;
    float _m26;
    _2253 _m27;
    _291 _m28;
    uint _m29;
    uint _m30;
};

layout(set = 3) uniform _708 PerViewLightingConstantBufferGpu_t;

layout(set = 3, binding = 30, std430) readonly buffer g_CullBits
{
    uint _m0[];
} g_CullBits_1;

layout(set = 3, binding = 31, std430) readonly buffer g_BarnLights
{
    layout(row_major) _200 _m0[];
} g_BarnLights_1;

struct _2006
{
    _2029 _m0;
};

layout(set = 1) uniform _2006 PerViewLightProbeVolumeConstantBuffer_t;

layout(set = 4, binding = 46) uniform texture2D g_bindless_Texture2D_float4[65536];
layout(set = 4, binding = 29) uniform sampler g_bindless_Sampler[2048];
layout(set = 4, binding = 29) uniform samplerShadow g_bindless_Sampler_1[2048];
layout(set = 4, binding = 46) uniform texture3D g_bindless_Texture3D_float4[65536];
layout(set = 4, binding = 46) uniform textureCubeArray g_bindless_TextureCubeArray[65536];
layout(set = 4, binding = 46) uniform texture2DArray g_bindless_Texture2DArray_float4[65536];
layout(set = 4, binding = 46) uniform textureCube g_bindless_TextureCube_float4[65536];

layout(location = 0) in vec3 input_0;
layout(location = 1) in vec3 input_1;
layout(location = 2) in vec3 input_2;
layout(location = 3) in vec4 input_3;
layout(location = 4) centroid in vec4 input_4;
layout(location = 5) centroid in vec3 input_5;
layout(location = 6) in vec4 input_6;
layout(location = 0) out vec4 output_0;

void main()
{
    vec4 _11408 = gl_FragCoord;
    _11408.w = 1.0 / _11408.w;
    float _21709;
    if (_Globals_.g_flWaterHeightMinOs < _Globals_.g_flWaterHeightMaxOs)
    {
        _21709 = (1.0 - smoothstep(_Globals_.g_flWaterHeightMinOs, _Globals_.g_flWaterHeightMaxOs + 4.0, input_0.z)) + (_Globals_.g_flWaterHeightMaxOs * 0.0199999995529651641845703125);
    }
    else
    {
        _21709 = 0.0;
    }
    float _12497 = (saturate(_21709 + _Globals_.g_flRainExposureToSkyWetness) * 1.10000002384185791015625) * PerViewConstantBufferCsgo_t._m13;
    bool _15436 = _12497 > 0.0;
    float _13136;
    vec2 _13998;
    float _16305;
    float _17114;
    vec4 _23261;
    if (_15436)
    {
        vec3 _10413 = input_1 + PerViewConstantBufferCsgo_t._m27.xyz;
        vec2 _18197 = input_3.xy * 2.5;
        vec2 _20826;
        if ((length(cross(vec3(dFdx(input_3.xy), 0.0), vec3(dFdy(input_3.xy), 0.0))) / max(9.9999997473787516355514526367188e-05, length(cross(dFdx(_10413), dFdy(_10413))))) < 0.00200000009499490261077880859375)
        {
            _20826 = _18197 * 3.0;
        }
        else
        {
            _20826 = _18197;
        }
        vec4 _20877 = texture(sampler2D(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m11], g_bindless_Sampler[_Globals_.g_sAniso]), (_20826 + (_10413.xy * 9.9999997473787516355514526367188e-05)).xy);
        vec2 _8562 = (_20877.xy * 2.0) - vec2(1.0);
        _8562.y = -_8562.y;
        float _7729 = _20877.w;
        float _12471 = _20877.z + (input_0.x * 0.00999999977648258209228515625);
        float _10538 = saturate((((_12497 * 0.25) - fract(_12471 + (((_Globals_.g_flRainExposureLocalTimer * 0.100000001490116119384765625) * PerViewConstantBufferCsgo_t._m12) * PerViewConstantBufferCsgo_t._m12))) * 5.0) / (PerViewConstantBufferCsgo_t._m13 + 0.001000000047497451305389404296875)) * saturate((input_2.z + 0.75) * 4.0);
        vec2 _13861 = input_3.xy + (((_8562.xy * (-0.0199999995529651641845703125)) * _10538) * _7729);
        vec4 _20488;
        _20488.x = _13861.x;
        _20488.y = _13861.y;
        _13136 = _10538;
        _16305 = _7729;
        _17114 = _12471;
        _13998 = _8562;
        _23261 = _20488;
    }
    else
    {
        _13136 = 0.0;
        _16305 = 0.0;
        _17114 = 0.0;
        _13998 = vec2(0.0);
        _23261 = input_3;
    }
    vec3 _21710;
    if (dot(input_2.xyz, input_2.xyz) >= 1.0099999904632568359375)
    {
        _21710 = input_5.xyz;
    }
    else
    {
        _21710 = input_2.xyz;
    }
    bool _14874 = _Globals_.g_bRenderBackfaceNormals != 0;
    bool _12885;
    if (_14874)
    {
        _12885 = _Globals_.g_bDontFlipBackfaceNormals == 0;
    }
    else
    {
        _12885 = false;
    }
    vec3 _10251;
    SPIRV_CROSS_BRANCH
    if (_12885)
    {
        _10251 = _21710 * (gl_FrontFacing ? 1.0 : (-1.0));
    }
    else
    {
        _10251 = _21710;
    }
    vec3 _24347 = normalize(_10251);
    vec3 _10061 = input_1 + PerViewConstantBufferCsgo_t._m27.xyz;
    vec4 _19680 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tColor], g_bindless_Sampler[_Globals_.g_sUserConfigAllowGlobalMipBias]), _23261.xy);
    vec3 _21103 = _19680.xyz * input_4.xyz;
    vec4 _19068 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tAmbientOcclusion], g_bindless_Sampler[_Globals_.g_sUserConfig]), vec2(_23261.xy).xy);
    float _17476 = _19068.x;
    vec4 _19069 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tMetalness], g_bindless_Sampler[_Globals_.g_sUserConfig]), _23261.xy);
    float _17477 = _19069.y;
    bool _14875 = _Globals_.g_bClothShading != 0;
    float _21711;
    if (_14875)
    {
        _21711 = _19069.z * (1.0 - _17477);
    }
    else
    {
        _21711 = 0.0;
    }
    vec4 _19372 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tNormal], g_bindless_Sampler[_Globals_.g_sUserConfig]), _23261.xy);
    float _16000 = _19372.x;
    float _19720 = _19372.y;
    float _16783 = (_16000 + _19720) - 1.00392162799835205078125;
    float _11176 = _16000 - _19720;
    vec3 _18354 = normalize(vec3(vec2(_16783, _11176), (1.0 - abs(_16783)) - abs(_11176)));
    bool _12886;
    if (_14874)
    {
        _12886 = _Globals_.g_bDontFlipBackfaceNormals == 0;
    }
    else
    {
        _12886 = false;
    }
    bool _24327;
    if (_12886)
    {
        _24327 = !gl_FrontFacing;
    }
    else
    {
        _24327 = false;
    }
    vec3 _12631 = input_2.xyz * (_24327 ? (-1.0) : 1.0);
    float _23240 = (input_6.w > 0.0) ? 1.0 : (-1.0);
    vec3 _14435 = cross(_12631.xyz, input_6.xyz) * _23240;
    bvec4 _24464 = notEqual(PerViewConstantBufferCsgo_t._m3, ivec4(0));
    bool _20058 = _24464.w;
    vec3 _7424;
    if (_20058)
    {
        _7424 = -_14435;
    }
    else
    {
        _7424 = _14435;
    }
    vec3 _20480;
    if (!_24327)
    {
        vec3 _7482 = _18354;
        _7482.y = -_18354.y;
        _20480 = _7482;
    }
    else
    {
        _20480 = _18354;
    }
    vec3 _6616;
    vec3 _13137;
    float _13694;
    vec2 _16306;
    float _17115;
    vec3 _17116;
    if (_15436)
    {
        float _14970 = mix(saturate((_19372.z - 0.75) * 4.0), 1.0, _21711);
        float _8927 = sqrt(1.0 - saturate(dot(_13998.xy, _13998.xy)));
        float _20709 = saturate(_12497);
        float _23650 = (saturate((_13136 * _16305) + (_20709 * 0.5)) * ((_14970 * 0.75) + 0.25)) * _20709;
        float _18483 = _13136 * saturate(1.0 - _14970);
        float _22907 = _18483 * _16305;
        _13137 = mix(_21103, pow(_21103, vec3(1.60000002384185791015625)) * 0.60000002384185791015625, vec3(_23650));
        _16306 = mix(_19372.zz, vec2(mix(0.100000001490116119384765625, 0.5, _21711)), vec2(_17476 * saturate(((_22907 * 4.0) + ((((cos((_17114 + (_Globals_.g_flRainExposureLocalTimer * 0.20000000298023223876953125)) * 6.28318500518798828125) * 0.5) + 0.5) * _20709) * 0.20000000298023223876953125)) + (_12497 * 0.4000000059604644775390625))));
        _17115 = _21711 * mix(1.0, 0.0, _23650);
        _17116 = mix(normalize(mix(_24347, normalize((((input_6.xyz * _20480.x).xyz + (_7424.xyz * _20480.y)).xyz + (_12631.xyz * _20480.z)).xyz), vec3(1.0 + (_23650 * 1.5)))), normalize((((input_6.xyz * _13998.x).xyz + (_7424.xyz * _13998.y)).xyz + (_24347.xyz * _8927)).xyz), vec3(_18483));
        _13694 = saturate(_22907 * 2.0);
        _6616 = mix(_20480, vec3(_13998.xy, _8927) * vec3(-1.0, -1.0, 1.0), vec3(_18483 * 0.25));
    }
    else
    {
        _13137 = _21103;
        _16306 = _19372.zz;
        _17115 = _21711;
        _17116 = vec3(1.0);
        _13694 = 0.0;
        _6616 = _20480;
    }
    bool _10513 = PerViewConstantBufferCsgo_t._m31.x > 0.0;
    float _21712;
    SPIRV_CROSS_BRANCH
    if (_10513)
    {
        _21712 = length(PerViewConstantBuffer_t._m7.xyz - _10061.xyz) / PerViewConstantBufferCsgo_t._m30;
    }
    else
    {
        _21712 = 0.0;
    }
    vec3 _6617;
    float _13140;
    vec3 _13695;
    float _16308;
    vec2 _17119;
    float _17120;
    if (_Globals_.g_bEnablePatch0 != 0)
    {
        float _13139;
        float _16307;
        vec3 _16479;
        vec2 _17117;
        float _17118;
        vec3 _17190;
        do
        {
            bool _19643 = _24464.y;
            float _24600 = _19643 ? 0.0 : input_4.w;
            if (_Globals_.g_flPatch0Scale == 0.0)
            {
                _13139 = _24600;
                _16307 = _17476;
                _17117 = _16306;
                _17118 = _17477;
                _17190 = _6616;
                _16479 = _13137;
                break;
            }
            float _14626 = abs(_Globals_.g_flPatch0Scale);
            vec2 _8647 = (_23261.xy - vec2(0.5)) - _Globals_.g_vPatch0Offset;
            vec2 _20143 = _8647 * _14626;
            float _21690 = _20143.y * _Globals_.g_flPatch0Squash;
            float _10278 = _20143.x;
            float _11850 = cos(_Globals_.g_flPatch0Rotation);
            float _7219 = sin(_Globals_.g_flPatch0Rotation);
            vec2 _15799 = vec2((_10278 * _11850) - (_21690 * _7219), (_10278 * _7219) + (_21690 * _11850)) + vec2(0.5);
            float _10367 = _15799.x;
            bool _12887;
            if (saturate(_10367) != _10367)
            {
                _12887 = true;
            }
            else
            {
                float _11829 = _15799.y;
                _12887 = saturate(_11829) != _11829;
            }
            if (_12887)
            {
                _13139 = _24600;
                _16307 = _17476;
                _17117 = _16306;
                _17118 = _17477;
                _17190 = _6616;
                _16479 = _13137;
                break;
            }
            vec2 _13138;
            vec4 _13151;
            vec4 _23607;
            if (_Globals_.g_flPatch0BackingScale != 0.0)
            {
                vec2 _9716;
                vec2 _24878;
                if (_Globals_.g_flPatch0BackingScale < 1.0)
                {
                    vec2 _13992 = _8647 * (_14626 * (1.0 / abs(_Globals_.g_flPatch0BackingScale)));
                    float _23976 = _13992.y * _Globals_.g_flPatch0Squash;
                    float _6537 = _13992.x;
                    _9716 = _15799;
                    _24878 = vec2((_6537 * _11850) - (_23976 * _7219), (_6537 * _7219) + (_23976 * _11850)) + vec2(0.5);
                }
                else
                {
                    vec2 _18464 = _8647 * (_14626 * abs(_Globals_.g_flPatch0BackingScale));
                    float _23975 = _18464.y * _Globals_.g_flPatch0Squash;
                    float _6536 = _18464.x;
                    _9716 = vec2((_6536 * _11850) - (_23975 * _7219), (_6536 * _7219) + (_23975 * _11850)) + vec2(0.5);
                    _24878 = _15799;
                }
                vec4 _19338 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch0Backing], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _24878.xy);
                vec4 _19681 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch0], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _9716.xy);
                float _7414 = _19681.w;
                _13138 = _9716;
                _13151 = _19681;
                _23607 = vec4(mix(_19338.xyz, _19681.xyz, vec3(_7414)), max(_7414, _19338.w));
            }
            else
            {
                vec4 _12552 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch0], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _15799.xy);
                _13138 = _15799;
                _13151 = _12552;
                _23607 = _12552;
            }
            vec3 _20655 = vec3(_23607.w);
            vec3 _7756 = mix(_13137.xyz, _23607.xyz, _20655);
            float _19756 = saturate(PerViewConstantBuffer_t._m0 - _Globals_.g_flPatch0HighlightTime);
            vec3 _18402;
            if (_19756 < 1.0)
            {
                float _23867 = 1.0 - _19756;
                float _12653 = atan(_13138.x - 0.5, _13138.y - 0.5);
                vec3 _14361 = _7756.xyz;
                _18402 = mix(mix(_14361, _14361 * 2.5, vec3(_23867 * _13151.w)).xyz, vec3(0.699999988079071044921875, 1.0, 1.0), vec3(saturate(((_19756 * saturate((4.0 * _13151.w) * (1.0 - _13151.w))) * saturate(0.5 + sin((22.0 * _12653) + (_23867 * 3.0)))) * saturate(sin((2.0 * _12653) + (pow(_23867, 0.699999988079071044921875) * (-30.0)))))));
            }
            else
            {
                _18402 = _7756.xyz;
            }
            float _13212;
            vec3 _15670;
            if (_19643)
            {
                _13212 = _23607.w;
                _15670 = vec3(_13151.xyz);
            }
            else
            {
                _13212 = max(_24600, _23607.w);
                _15670 = _18402;
            }
            _13139 = _13212;
            _16307 = mix(_17476, 1.0, _23607.w);
            _17117 = mix(_16306.xy, vec2(0.699999988079071044921875), vec2(_23607.w));
            _17118 = mix(_17477, 0.300000011920928955078125, _23607.w);
            _17190 = mix(_6616.xyz, vec3(0.0, 0.0, 1.0), _20655);
            _16479 = _15670;
            break;
        } while(false);
        _13140 = _13139;
        _16308 = _16307;
        _17119 = _17117;
        _17120 = _17118;
        _13695 = _17190;
        _6617 = _16479;
    }
    else
    {
        _13140 = input_4.w;
        _16308 = _17476;
        _17119 = _16306;
        _17120 = _17477;
        _13695 = _6616;
        _6617 = _13137;
    }
    vec3 _6618;
    float _13143;
    vec3 _13696;
    float _16310;
    vec2 _17123;
    float _17124;
    if (_Globals_.g_bEnablePatch1 != 0)
    {
        float _13142;
        float _16309;
        vec3 _16480;
        vec2 _17121;
        float _17122;
        vec3 _17191;
        do
        {
            bool _19646 = _24464.y;
            float _24601 = _19646 ? 0.0 : _13140;
            if (_Globals_.g_flPatch1Scale == 0.0)
            {
                _13142 = _24601;
                _16309 = _16308;
                _17121 = _17119;
                _17122 = _17120;
                _17191 = _13695;
                _16480 = _6617;
                break;
            }
            float _14627 = abs(_Globals_.g_flPatch1Scale);
            vec2 _8648 = (_23261.xy - vec2(0.5)) - _Globals_.g_vPatch1Offset;
            vec2 _20144 = _8648 * _14627;
            float _21691 = _20144.y * _Globals_.g_flPatch1Squash;
            float _10279 = _20144.x;
            float _11851 = cos(_Globals_.g_flPatch1Rotation);
            float _7220 = sin(_Globals_.g_flPatch1Rotation);
            vec2 _15800 = vec2((_10279 * _11851) - (_21691 * _7220), (_10279 * _7220) + (_21691 * _11851)) + vec2(0.5);
            float _10368 = _15800.x;
            bool _12888;
            if (saturate(_10368) != _10368)
            {
                _12888 = true;
            }
            else
            {
                float _11830 = _15800.y;
                _12888 = saturate(_11830) != _11830;
            }
            if (_12888)
            {
                _13142 = _24601;
                _16309 = _16308;
                _17121 = _17119;
                _17122 = _17120;
                _17191 = _13695;
                _16480 = _6617;
                break;
            }
            vec2 _13141;
            vec4 _13152;
            vec4 _23609;
            if (_Globals_.g_flPatch1BackingScale != 0.0)
            {
                vec2 _9717;
                vec2 _24879;
                if (_Globals_.g_flPatch1BackingScale < 1.0)
                {
                    vec2 _13993 = _8648 * (_14627 * (1.0 / abs(_Globals_.g_flPatch1BackingScale)));
                    float _23978 = _13993.y * _Globals_.g_flPatch1Squash;
                    float _6539 = _13993.x;
                    _9717 = _15800;
                    _24879 = vec2((_6539 * _11851) - (_23978 * _7220), (_6539 * _7220) + (_23978 * _11851)) + vec2(0.5);
                }
                else
                {
                    vec2 _18465 = _8648 * (_14627 * abs(_Globals_.g_flPatch1BackingScale));
                    float _23977 = _18465.y * _Globals_.g_flPatch1Squash;
                    float _6538 = _18465.x;
                    _9717 = vec2((_6538 * _11851) - (_23977 * _7220), (_6538 * _7220) + (_23977 * _11851)) + vec2(0.5);
                    _24879 = _15800;
                }
                vec4 _19339 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch1Backing], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _24879.xy);
                vec4 _19682 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch1], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _9717.xy);
                float _7416 = _19682.w;
                _13141 = _9717;
                _13152 = _19682;
                _23609 = vec4(mix(_19339.xyz, _19682.xyz, vec3(_7416)), max(_7416, _19339.w));
            }
            else
            {
                vec4 _12553 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch1], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _15800.xy);
                _13141 = _15800;
                _13152 = _12553;
                _23609 = _12553;
            }
            vec3 _20656 = vec3(_23609.w);
            vec3 _7757 = mix(_6617.xyz, _23609.xyz, _20656);
            float _19757 = saturate(PerViewConstantBuffer_t._m0 - _Globals_.g_flPatch1HighlightTime);
            vec3 _18403;
            if (_19757 < 1.0)
            {
                float _23868 = 1.0 - _19757;
                float _12654 = atan(_13141.x - 0.5, _13141.y - 0.5);
                vec3 _14362 = _7757.xyz;
                _18403 = mix(mix(_14362, _14362 * 2.5, vec3(_23868 * _13152.w)).xyz, vec3(0.699999988079071044921875, 1.0, 1.0), vec3(saturate(((_19757 * saturate((4.0 * _13152.w) * (1.0 - _13152.w))) * saturate(0.5 + sin((22.0 * _12654) + (_23868 * 3.0)))) * saturate(sin((2.0 * _12654) + (pow(_23868, 0.699999988079071044921875) * (-30.0)))))));
            }
            else
            {
                _18403 = _7757.xyz;
            }
            float _13213;
            vec3 _15671;
            if (_19646)
            {
                _13213 = _23609.w;
                _15671 = vec3(_13152.xyz);
            }
            else
            {
                _13213 = max(_24601, _23609.w);
                _15671 = _18403;
            }
            _13142 = _13213;
            _16309 = mix(_16308, 1.0, _23609.w);
            _17121 = mix(_17119.xy, vec2(0.699999988079071044921875), vec2(_23609.w));
            _17122 = mix(_17120, 0.300000011920928955078125, _23609.w);
            _17191 = mix(_13695.xyz, vec3(0.0, 0.0, 1.0), _20656);
            _16480 = _15671;
            break;
        } while(false);
        _13143 = _13142;
        _16310 = _16309;
        _17123 = _17121;
        _17124 = _17122;
        _13696 = _17191;
        _6618 = _16480;
    }
    else
    {
        _13143 = _13140;
        _16310 = _16308;
        _17123 = _17119;
        _17124 = _17120;
        _13696 = _13695;
        _6618 = _6617;
    }
    vec2 _13146;
    float _13999;
    float _16312;
    float _17127;
    vec3 _17128;
    vec3 _24173;
    if (_Globals_.g_bEnablePatch2 != 0)
    {
        vec2 _13145;
        float _16311;
        vec3 _16481;
        float _17125;
        vec3 _17126;
        float _17192;
        do
        {
            bool _19649 = _24464.y;
            float _24602 = _19649 ? 0.0 : _13143;
            if (_Globals_.g_flPatch2Scale == 0.0)
            {
                _13145 = _17123;
                _16311 = _16310;
                _17125 = _24602;
                _17126 = _6618;
                _17192 = _17124;
                _16481 = _13696;
                break;
            }
            float _14628 = abs(_Globals_.g_flPatch2Scale);
            vec2 _8649 = (_23261.xy - vec2(0.5)) - _Globals_.g_vPatch2Offset;
            vec2 _20145 = _8649 * _14628;
            float _21692 = _20145.y * _Globals_.g_flPatch2Squash;
            float _10280 = _20145.x;
            float _11852 = cos(_Globals_.g_flPatch2Rotation);
            float _7221 = sin(_Globals_.g_flPatch2Rotation);
            vec2 _15801 = vec2((_10280 * _11852) - (_21692 * _7221), (_10280 * _7221) + (_21692 * _11852)) + vec2(0.5);
            float _10369 = _15801.x;
            bool _12889;
            if (saturate(_10369) != _10369)
            {
                _12889 = true;
            }
            else
            {
                float _11831 = _15801.y;
                _12889 = saturate(_11831) != _11831;
            }
            if (_12889)
            {
                _13145 = _17123;
                _16311 = _16310;
                _17125 = _24602;
                _17126 = _6618;
                _17192 = _17124;
                _16481 = _13696;
                break;
            }
            vec2 _13144;
            vec4 _13153;
            vec4 _23611;
            if (_Globals_.g_flPatch2BackingScale != 0.0)
            {
                vec2 _9718;
                vec2 _24880;
                if (_Globals_.g_flPatch2BackingScale < 1.0)
                {
                    vec2 _13994 = _8649 * (_14628 * (1.0 / abs(_Globals_.g_flPatch2BackingScale)));
                    float _23980 = _13994.y * _Globals_.g_flPatch2Squash;
                    float _6541 = _13994.x;
                    _9718 = _15801;
                    _24880 = vec2((_6541 * _11852) - (_23980 * _7221), (_6541 * _7221) + (_23980 * _11852)) + vec2(0.5);
                }
                else
                {
                    vec2 _18466 = _8649 * (_14628 * abs(_Globals_.g_flPatch2BackingScale));
                    float _23979 = _18466.y * _Globals_.g_flPatch2Squash;
                    float _6540 = _18466.x;
                    _9718 = vec2((_6540 * _11852) - (_23979 * _7221), (_6540 * _7221) + (_23979 * _11852)) + vec2(0.5);
                    _24880 = _15801;
                }
                vec4 _19340 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch2Backing], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _24880.xy);
                vec4 _19684 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch2], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _9718.xy);
                float _7418 = _19684.w;
                _13144 = _9718;
                _13153 = _19684;
                _23611 = vec4(mix(_19340.xyz, _19684.xyz, vec3(_7418)), max(_7418, _19340.w));
            }
            else
            {
                vec4 _12554 = texture(sampler2D(g_bindless_Texture2D_float4[_Globals_.g_tPatch2], g_bindless_Sampler[_Globals_.g_sAnisoClampPatchSampler]), _15801.xy);
                _13144 = _15801;
                _13153 = _12554;
                _23611 = _12554;
            }
            vec3 _20657 = vec3(_23611.w);
            vec3 _7758 = mix(_6618.xyz, _23611.xyz, _20657);
            float _19758 = saturate(PerViewConstantBuffer_t._m0 - _Globals_.g_flPatch2HighlightTime);
            vec3 _18404;
            if (_19758 < 1.0)
            {
                float _23869 = 1.0 - _19758;
                float _12655 = atan(_13144.x - 0.5, _13144.y - 0.5);
                vec3 _14363 = _7758.xyz;
                _18404 = mix(mix(_14363, _14363 * 2.5, vec3(_23869 * _13153.w)).xyz, vec3(0.699999988079071044921875, 1.0, 1.0), vec3(saturate(((_19758 * saturate((4.0 * _13153.w) * (1.0 - _13153.w))) * saturate(0.5 + sin((22.0 * _12655) + (_23869 * 3.0)))) * saturate(sin((2.0 * _12655) + (pow(_23869, 0.699999988079071044921875) * (-30.0)))))));
            }
            else
            {
                _18404 = _7758.xyz;
            }
            float _13214;
            vec3 _15672;
            if (_19649)
            {
                _13214 = _23611.w;
                _15672 = vec3(_13153.xyz);
            }
            else
            {
                _13214 = max(_24602, _23611.w);
                _15672 = _18404;
            }
            _13145 = mix(_17123.xy, vec2(0.699999988079071044921875), vec2(_23611.w));
            _16311 = mix(_16310, 1.0, _23611.w);
            _17125 = _13214;
            _17126 = _15672;
            _17192 = mix(_17124, 0.300000011920928955078125, _23611.w);
            _16481 = mix(_13696.xyz, vec3(0.0, 0.0, 1.0), _20657);
            break;
        } while(false);
        _13146 = _13145;
        _16312 = _16311;
        _17127 = _17125;
        _17128 = _17126;
        _13999 = _17192;
        _24173 = _16481;
    }
    else
    {
        _13146 = _17123;
        _16312 = _16310;
        _17127 = _13143;
        _17128 = _6618;
        _13999 = _17124;
        _24173 = _13696;
    }
    vec3 _7866 = _24173;
    _7866.y = -_24173.y;
    bool _12890;
    if (_14874)
    {
        _12890 = _Globals_.g_bDontFlipBackfaceNormals == 0;
    }
    else
    {
        _12890 = false;
    }
    bool _24328;
    if (_12890)
    {
        _24328 = !gl_FrontFacing;
    }
    else
    {
        _24328 = false;
    }
    vec3 _9739 = input_2.xyz * (_24328 ? (-1.0) : 1.0);
    vec3 _24682 = cross(_9739.xyz, input_6.xyz) * _23240;
    vec3 _7425;
    if (_20058)
    {
        _7425 = -_24682;
    }
    else
    {
        _7425 = _24682;
    }
    vec3 _20481;
    if (!_24328)
    {
        vec3 _23482 = _7866;
        _23482.y = _24173.y;
        _20481 = _23482;
    }
    else
    {
        _20481 = _7866;
    }
    vec3 _14786 = normalize((((input_6.xyz * _20481.x).xyz + (_7425.xyz * _20481.y)).xyz + (_9739.xyz * _20481.z)).xyz);
    vec3 _9186 = vec3(_Globals_.g_flReflectance);
    vec3 _19652;
    SPIRV_CROSS_BRANCH
    if (_14875)
    {
        _19652 = mix(_9186.xyz, saturate((_Globals_.g_flSheenTintColor.xyz * sqrt(_17128.xyz)) * _Globals_.g_flSheenScale), vec3(_17115));
    }
    else
    {
        _19652 = _9186;
    }
    vec3 _9451 = mix(_19652.xyz, _17128.xyz, vec3(_13999));
    vec3 _17892 = mix(_17116, _14786, bvec3(all(equal(_17116, vec3(1.0)))));
    vec3 _10560 = _24347.xyz;
    vec3 _11099 = dFdx(_10560);
    vec3 _9175 = dFdy(_10560);
    vec3 _10347 = _11099.xyz;
    vec3 _12420 = _9175.xyz;
    vec2 _11004 = max(_13146.xy, vec2(pow(saturate(max(dot(_10347, _10347), dot(_12420, _12420))), 0.333000004291534423828125)));
    vec3 _10170 = -_24347;
    vec3 _24735 = _14786.xyz;
    vec4 _23875 = vec4(_24735, 1.0);
    vec3 _18708 = vec3(dot(PerViewLightingConstantBufferGpu_t._m5._m0[0].xyzw, _23875), dot(PerViewLightingConstantBufferGpu_t._m5._m0[1].xyzw, _23875), dot(PerViewLightingConstantBufferGpu_t._m5._m0[2].xyzw, _23875));
    bvec4 _24465 = notEqual(PerViewConstantBufferCsgo_t._m1, ivec4(0));
    float _21713;
    if (_24465.x)
    {
        vec3 _11394 = _24347.xyz;
        vec2 _11093 = ((floor(_11408.xy * PerViewConstantBufferCsgo_t._m17) * PerViewConstantBufferCsgo_t._m16.xy) + (PerViewConstantBufferCsgo_t._m16.xy * 0.5)).xy;
        vec4 _18418 = textureGather(sampler2D(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m8], g_bindless_Sampler[_Globals_.g_sCookieSampler]), _11093).xyzw - _11408.zzzz;
        float _18579 = _18418.w;
        float _12013 = _18418.z;
        bool _12285 = abs(_12013) < _18579;
        vec2 _23168;
        if (_12285)
        {
            _23168 = vec2(PerViewConstantBufferCsgo_t._m16.x, 0.0);
        }
        else
        {
            _23168 = vec2(0.0);
        }
        float _20967 = _12285 ? _12013 : _18579;
        float _15372 = _18418.x;
        bool _12286 = abs(_15372) < _20967;
        vec2 _23169;
        if (_12286)
        {
            _23169 = vec2(0.0, PerViewConstantBufferCsgo_t._m16.y);
        }
        else
        {
            _23169 = _23168;
        }
        vec4 _10010 = normalize(vec4(PerViewLightingConstantBufferGpu_t._m7.x * fma(dot(_10170, normalize(vec3(PerViewLightingConstantBufferGpu_t._m6._m0[0].xy, 0.25))), 0.5, 0.5), PerViewLightingConstantBufferGpu_t._m7.y * fma(dot(_10170, normalize(vec3(PerViewLightingConstantBufferGpu_t._m6._m0[1].xy, 0.25))), 0.5, 0.5), PerViewLightingConstantBufferGpu_t._m7.z * fma(dot(_10170, normalize(vec3(PerViewLightingConstantBufferGpu_t._m6._m0[2].xy, 0.25))), 0.5, 0.5), PerViewLightingConstantBufferGpu_t._m7.w * fma(dot(_10170, normalize(vec3(PerViewLightingConstantBufferGpu_t._m6._m0[3].xy, 0.25))), 0.5, 0.5)));
        vec4 _13232 = max(vec4(dot(PerViewLightingConstantBufferGpu_t._m6._m0[0].xyz, _11394), dot(PerViewLightingConstantBufferGpu_t._m6._m0[1].xyz, _11394), dot(PerViewLightingConstantBufferGpu_t._m6._m0[2].xyz, _11394), dot(PerViewLightingConstantBufferGpu_t._m6._m0[3].xyz, _11394)).xyzw, vec4(0.0)) * normalize(saturate(((_10010 - vec4(max(max(_10010.x, _10010.y), max(_10010.z, _10010.w)))) + vec4(0.20000000298023223876953125)) * vec4(5.0)));
        _21713 = (1.0 / (dot(_13232, vec4(1.0)) + PerViewLightingConstantBufferGpu_t._m8.x)) * (PerViewLightingConstantBufferGpu_t._m8.x + dot(_13232, textureLod(sampler2D(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m7], g_bindless_Sampler[_Globals_.g_sPointClamp]), (_11093 + mix(_23169, PerViewConstantBufferCsgo_t._m16.xy, bvec2(abs(_18418.y) < (_12286 ? _15372 : _20967))).xy).xy, 0.0)));
    }
    else
    {
        _21713 = 1.0;
    }
    float _21714;
    if (notEqual(PerViewConstantBufferCsgo_t._m0, ivec4(0)).w)
    {
        _21714 = _21713 * textureLod(sampler2D(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m9], g_bindless_Sampler[_Globals_.g_sUserConfig]), (_11408.xy * PerViewConstantBuffer_t._m4.xy).xy, 0.0).x;
    }
    else
    {
        _21714 = _21713;
    }
    float _21715;
    SPIRV_CROSS_BRANCH
    if (PerViewLightingConstantBufferGpu_t._m20 != 0)
    {
        int _23989;
        int _10191;
        float _13147;
        vec3 _14975;
        int _13039 = 0;
        for (;;)
        {
            if (!(_13039 < PerViewLightingConstantBufferGpu_t._m20))
            {
                _13147 = 1.0;
                _14975 = vec3(0.0);
                _10191 = -1;
                break;
            }
            vec4 _18322 = vec4(input_1.xyz, 1.0) * PerViewLightingConstantBufferGpu_t._m27._m0[_13039];
            float _12779 = _18322.x;
            if (max(abs(_12779), abs(_18322.y)) < PerViewLightingConstantBufferGpu_t._m22[_13039])
            {
                vec3 _19470 = vec3(_12779, _18322.yz);
                vec2 _24804 = _19470.xy;
                vec2 _22193 = vec2(1.0) - saturate((abs(_24804) * vec2(PerViewLightingConstantBufferGpu_t._m24)) + vec2(PerViewLightingConstantBufferGpu_t._m23));
                vec2 _20561 = (_24804 * PerViewLightingConstantBufferGpu_t._m28._m0[_13039].zw) + PerViewLightingConstantBufferGpu_t._m28._m0[_13039].xy;
                vec3 _20489 = _19470;
                _20489.x = _20561.x;
                _20489.y = _20561.y;
                _13147 = saturate(_22193.x * _22193.y);
                _14975 = _20489;
                _10191 = _13039;
                break;
            }
            _23989 = _13039 + 1;
            _13039 = _23989;
            continue;
        }
        float _19363;
        if (_10191 >= 0)
        {
            vec2 _7045;
            vec2 _7046;
            vec2 _7735;
            float _8969;
            float _8970;
            float _15996;
            float _17299;
            vec2 _18870;
            vec4 _20581;
            vec4 _24389;
            uint _24711;
            float _23727;
            do
            {
                float _21452 = saturate(_14975.z + PerViewLightingConstantBufferGpu_t._m21);
                _20581 = PerViewLightingConstantBufferGpu_t._m0;
                _24389 = PerViewLightingConstantBufferGpu_t._m1;
                _24711 = _Globals_.g_tShadowDepthBufferCmpSampler;
                _17299 = PerViewLightingConstantBufferGpu_t._m2.z;
                _15996 = PerViewLightingConstantBufferGpu_t._m3.z;
                _18870 = vec2(_17299, _15996);
                _8969 = PerViewLightingConstantBufferGpu_t._m2.y;
                _7045 = vec2(_8969, _15996);
                _8970 = PerViewLightingConstantBufferGpu_t._m3.y;
                _7046 = vec2(_17299, _8970);
                _7735 = vec2(_8969, _8970);
                float _15310 = dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + _18870).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + _7045).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + _7046).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + _7735).xy, _21452), 0.0)).xyzw, vec4(0.25));
                bool _12891;
                if (_15310 == 0.0)
                {
                    _12891 = true;
                }
                else
                {
                    _12891 = _15310 == 1.0;
                }
                if (_12891)
                {
                    _23727 = _15310;
                    break;
                }
                _23727 = ((_15310 * (_20581.w * 4.0)) + dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + vec2(_17299, 0.0)).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + vec2(_8969, 0.0)).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + vec2(0.0, _8970)).xy, _21452), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_14975.xy + vec2(0.0, _15996)).xy, _21452), 0.0)).xyzw, _24389.xxxx)) + (textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3(_14975.xy, _21452), 0.0) * _24389.y);
                break;
            } while(false);
            float _12502;
            SPIRV_CROSS_BRANCH
            if (_13147 < 1.0)
            {
                float _7934;
                if (_10191 < (PerViewLightingConstantBufferGpu_t._m20 - 1))
                {
                    int _15335 = _10191 + 1;
                    vec4 _19671 = vec4(input_1.xyz, 1.0) * PerViewLightingConstantBufferGpu_t._m27._m0[_15335];
                    vec2 _20562 = (_19671.xy * PerViewLightingConstantBufferGpu_t._m28._m0[_15335].zw) + PerViewLightingConstantBufferGpu_t._m28._m0[_15335].xy;
                    vec3 _20490;
                    _20490.x = _20562.x;
                    _20490.y = _20562.y;
                    float _12501;
                    do
                    {
                        float _20322 = saturate(_19671.z + PerViewLightingConstantBufferGpu_t._m21);
                        float _15311 = dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + _18870).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + _7045).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + _7046).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + _7735).xy, _20322), 0.0)).xyzw, vec4(0.25));
                        bool _12892;
                        if (_15311 == 0.0)
                        {
                            _12892 = true;
                        }
                        else
                        {
                            _12892 = _15311 == 1.0;
                        }
                        if (_12892)
                        {
                            _12501 = _15311;
                            break;
                        }
                        _12501 = ((_15311 * (_20581.w * 4.0)) + dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + vec2(_17299, 0.0)).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + vec2(_8969, 0.0)).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + vec2(0.0, _8970)).xy, _20322), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3((_20490.xy + vec2(0.0, _15996)).xy, _20322), 0.0)).xyzw, _24389.xxxx)) + (textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_24711]), vec3(_20490.xy, _20322), 0.0) * _24389.y);
                        break;
                    } while(false);
                    _7934 = _12501;
                }
                else
                {
                    _7934 = 1.0;
                }
                _12502 = mix(_7934, _23727, _13147);
            }
            else
            {
                _12502 = _23727;
            }
            _19363 = _12502;
        }
        else
        {
            _19363 = 1.0;
        }
        float _13279 = mix(_19363, 1.0, saturate((distance(_10061.xyz, PerViewConstantBuffer_t._m7) * PerViewLightingConstantBufferGpu_t._m26) + PerViewLightingConstantBufferGpu_t._m25));
        float _12503;
        if (_24465.y)
        {
            _12503 = min(_13279, textureLod(sampler2D(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m10], g_bindless_Sampler[_Globals_.g_sTrilinearClamp]), (_11408.xy * PerViewConstantBuffer_t._m4.xy).xy, 0.0).z);
        }
        else
        {
            _12503 = _13279;
        }
        _21715 = _12503;
    }
    else
    {
        _21715 = 1.0;
    }
    vec3 _9720;
    vec3 _24883;
    SPIRV_CROSS_BRANCH
    if ((dot(PerViewLightingConstantBufferGpu_t._m18.xyz, _24735) * _21715) > 0.0)
    {
        vec3 _15460 = mix(_17892, _24735, bvec3(all(equal(_17892, vec3(1.0)))));
        float _13811 = max(0.0, dot(_14786.xyz, PerViewLightingConstantBufferGpu_t._m18.xyz));
        vec3 _17874 = vec3(_13811);
        vec3 _18223;
        if (_13694 > 0.0)
        {
            float _8780 = dot(_15460, PerViewLightingConstantBufferGpu_t._m18.xyz);
            float _8124 = saturate(_13694);
            _18223 = mix(_17874.xyz, vec3((((0.5 + (_13811 * 0.5)) + pow(1.0 - saturate(_8780), 4.0)) * saturate((_8780 + 0.20000000298023223876953125) * 4.0)) * saturate(mix(dot(mix(_24735, _15460, vec3(10.0)), PerViewLightingConstantBufferGpu_t._m18.xyz), 1.0, _8124))), vec3(_8124));
        }
        else
        {
            _18223 = _17874;
        }
        vec2 _17301 = max(_11004, vec2(PerViewLightingConstantBufferGpu_t._m18.w));
        vec3 _21889 = (-normalize(_10061.xyz - PerViewConstantBuffer_t._m7.xyz)).xyz;
        vec3 _12281 = normalize(PerViewLightingConstantBufferGpu_t._m18.xyz + _21889).xyz;
        vec3 _19012 = _15460.xyz;
        float _12386 = dot(_12281, _19012);
        float _25073 = max(0.0, dot(_19012, _21889));
        vec3 _22995 = _9451.xyz;
        float _9850 = _17301.x;
        float _25211 = _9850 * _9850;
        float _19097 = _12386 * _12386;
        float _24198 = _25211 / ((_19097 * ((_25211 * _25211) - 1.0)) + 1.0);
        float _16150 = _9850 + 1.0;
        float _6835 = (_16150 * _16150) * 0.125;
        float _19569 = 1.0 - _6835;
        float _21624 = (_24198 * _24198) / ((4.0 * ((_13811 * _19569) + _6835)) * ((_25073 * _19569) + _6835));
        float _11621;
        SPIRV_CROSS_BRANCH
        if (_14875)
        {
            float _6597 = dot(_17301.xy, vec2(0.5));
            float _20791 = max(_6597 * _6597, 9.9999997473787516355514526367188e-06);
            float _21401 = saturate(_25073 + 0.001000000047497451305389404296875);
            _11621 = mix(_21624, ((((2.0 + (1.0 / _20791)) * pow(1.0 - _19097, 0.5 / _20791)) / ((_13811 + _21401) - (_13811 * _21401))) * 0.124999918043613433837890625) * _13811, _17115);
        }
        else
        {
            _11621 = _21624;
        }
        vec3 _15806 = ((_22995 + ((vec3(1.0) - _22995) * pow(max(9.9999999747524270787835121154785e-07, 1.0 - max(0.0, dot(PerViewLightingConstantBufferGpu_t._m18.xyz, _12281))), 5.0))) * _11621).xyz * _13811;
        vec3 _9719;
        vec3 _24882;
        if (notEqual(PerViewConstantBufferCsgo_t._m2, ivec4(0)).w)
        {
            float _22996 = smoothstep(0.0, 1.0, saturate(dot(_24735, PerViewLightingConstantBufferGpu_t._m18.xyz) / sqrt(max(1.0 - _16312, 9.9999997473787516355514526367188e-06))));
            _9719 = _15806 * _22996;
            _24882 = _18223 * _22996;
        }
        else
        {
            _9719 = _15806;
            _24882 = _18223;
        }
        vec3 _16808 = (PerViewLightingConstantBufferGpu_t._m19.xyz * _21715).xyz;
        _9720 = PerViewLightingConstantBufferGpu_t._m9.xyz + (_24882.xyz * _16808);
        _24883 = _9719.xyz * _16808;
    }
    else
    {
        _9720 = PerViewLightingConstantBufferGpu_t._m9.xyz;
        _24883 = vec3(0.0);
    }
    bvec4 _24468 = notEqual(PerViewConstantBufferCsgo_t._m2, ivec4(0));
    bool _20062 = _24468.x;
    vec4 _19364;
    if (_20062)
    {
        vec4 _18621 = vec4(_10061.xyz, 1.0).xyzw * PerViewConstantBufferCsgo_t._m15;
        float _20176 = _18621.w;
        vec2 _11414 = _18621.xy / vec2(_20176);
        vec4 _6651;
        _6651.x = clamp(((_11414.x + 1.0) * PerViewConstantBuffer_t._m3.x) * 0.5, 0.0, PerViewConstantBuffer_t._m3.x - 1.0);
        _6651.y = clamp(((1.0 - _11414.y) * PerViewConstantBuffer_t._m3.y) * 0.5, 0.0, PerViewConstantBuffer_t._m3.y - 1.0);
        _6651.w = _20176;
        _19364 = _6651;
    }
    else
    {
        _19364 = _11408;
    }
    uvec2 _7663 = uvec2(PerViewLightingConstantBufferGpu_t._m13.x);
    uvec2 _12083 = uvec2(_19364.xy - PerViewConstantBuffer_t._m2.xy) >> _7663;
    uint _10838 = PerViewLightingConstantBufferGpu_t._m10.y + (((_12083.y * PerViewLightingConstantBufferGpu_t._m13.y) + _12083.x) * PerViewLightingConstantBufferGpu_t._m10.z);
    uint _23393 = PerViewLightingConstantBufferGpu_t._m10.x + (uint(clamp(_19364.w * PerViewLightingConstantBufferGpu_t._m14.x, 0.0, PerViewLightingConstantBufferGpu_t._m14.y)) * PerViewLightingConstantBufferGpu_t._m10.z);
    vec3 _13148;
    vec3 _16324;
    _13148 = _9720;
    _16324 = _24883;
    uint _21567;
    vec3 _13149;
    vec3 _16325;
    uint _17017 = 0u;
    for (;;)
    {
        if (!(_17017 < PerViewLightingConstantBufferGpu_t._m10.z))
        {
            break;
        }
        uint _14475 = subgroupOr(g_CullBits_1._m0[_10838 + _17017] & g_CullBits_1._m0[_23393 + _17017]);
        _13149 = _16324;
        _16325 = _13148;
        uint _20344;
        vec3 _13215;
        vec3 _15675;
        uint _17018 = _14475;
        for (;;)
        {
            if (!(_17018 != 0u))
            {
                break;
            }
            int _12608 = int(uint(findLSB(_17018)) + (_17017 * 32u));
            _20344 = _17018 & (_17018 - 1u);
            do
            {
                vec4 _24893 = g_BarnLights_1._m0[_12608]._m0 * vec4(input_1.xyz, 1.0);
                vec3 _10521 = _24893.xyz / vec3(_24893.w);
                vec4 _22905;
                _22905.x = _10521.x;
                _22905.y = _10521.y;
                float _21775 = _10521.z;
                _22905.z = _21775;
                vec3 _21642 = _22905.xyz;
                bool _7426;
                if (all(greaterThan(_22905.xyz, vec3(-1.0, -1.0, 0.0))))
                {
                    _7426 = all(lessThan(_22905.xyz, vec3(1.0)));
                }
                else
                {
                    _7426 = false;
                }
                bool _12893;
                if (!_7426)
                {
                    _12893 = true;
                }
                else
                {
                    _12893 = !all(lessThanEqual(abs((g_BarnLights_1._m0[_12608]._m15 * vec4(input_1.xyz, 1.0)).xyz), vec3(1.0)));
                }
                if (_12893)
                {
                    _13215 = _13149;
                    _15675 = _16325;
                    break;
                }
                float _23571 = 2.0 * g_BarnLights_1._m0[_12608]._m5.y;
                float _18492 = (2.0 * g_BarnLights_1._m0[_12608]._m5.z) * g_BarnLights_1._m0[_12608]._m5.z;
                float _14805 = 2.0 * g_BarnLights_1._m0[_12608]._m5.x;
                float _9058 = _14805 * g_BarnLights_1._m0[_12608]._m5.y;
                float _17330 = 2.0 * g_BarnLights_1._m0[_12608]._m5.w;
                float _19825 = _17330 * g_BarnLights_1._m0[_12608]._m5.z;
                vec3 _16268 = vec3(_9058 - _19825, (1.0 - (_14805 * g_BarnLights_1._m0[_12608]._m5.x)) - _18492, (_23571 * g_BarnLights_1._m0[_12608]._m5.z) + (_17330 * g_BarnLights_1._m0[_12608]._m5.x)) * g_BarnLights_1._m0[_12608]._m6.z;
                float _21316;
                if (g_BarnLights_1._m0[_12608]._m3.z > 0.0)
                {
                    _21316 = smoothstep(0.0, 1.0, _21775 * g_BarnLights_1._m0[_12608]._m3.z);
                }
                else
                {
                    _21316 = 1.0;
                }
                float _19667;
                if (g_BarnLights_1._m0[_12608]._m3.w > 0.0)
                {
                    _19667 = _21316 * smoothstep(0.0, 1.0, (1.0 - _21775) * g_BarnLights_1._m0[_12608]._m3.w);
                }
                else
                {
                    _19667 = _21316;
                }
                vec3 _11179;
                float _11633;
                if (g_BarnLights_1._m0[_12608]._m2.w != 0.0)
                {
                    vec3 _10017 = g_BarnLights_1._m0[_12608]._m2.xyz - input_1.xyz;
                    float _18345 = dot(_10017, _10017);
                    float _17647 = sqrt(_18345);
                    vec3 _20958 = _10017 - _16268;
                    vec3 _10210;
                    do
                    {
                        vec3 _20229 = (_10017 + _16268) - _20958;
                        float _25105 = dot(-_20958, _20229);
                        if (_25105 <= 0.0)
                        {
                            _10210 = _20958;
                            break;
                        }
                        else
                        {
                            _10210 = _20958 + (_20229 * min(1.0, _25105 / dot(_20229, _20229)));
                            break;
                        }
                        break; // unreachable workaround
                    } while(false);
                    _11179 = _10017 / vec3(_17647);
                    _11633 = ((_19667 * (g_BarnLights_1._m0[_12608]._m2.w / max(_18345, g_BarnLights_1._m0[_12608]._m2.w))) * smoothstep(0.0, 1.0, g_BarnLights_1._m0[_12608]._m3.x + (g_BarnLights_1._m0[_12608]._m3.y * _17647))) * saturate(g_BarnLights_1._m0[_12608]._m6.x + (g_BarnLights_1._m0[_12608]._m6.y * dot(vec3((1.0 - (_23571 * g_BarnLights_1._m0[_12608]._m5.y)) - _18492, _9058 + _19825, (_14805 * g_BarnLights_1._m0[_12608]._m5.z) - (_17330 * g_BarnLights_1._m0[_12608]._m5.y)), normalize(_10210))));
                }
                else
                {
                    _11179 = g_BarnLights_1._m0[_12608]._m2.xyz;
                    _11633 = _19667;
                }
                vec3 _17828 = (g_BarnLights_1._m0[_12608]._m4.xyz * 1.0).xyz * _11633;
                bool _24419;
                if (g_BarnLights_1._m0[_12608]._m8.z > 0.0)
                {
                    _24419 = !_20062;
                }
                else
                {
                    _24419 = false;
                }
                vec3 _21548;
                SPIRV_CROSS_BRANCH
                if (g_BarnLights_1._m0[_12608]._m4.w == 0.0)
                {
                    float _10342;
                    do
                    {
                        vec2 _22154 = abs(_22905.xy);
                        if (g_BarnLights_1._m0[_12608]._m9.z == 0.0)
                        {
                            _10342 = smoothstep(1.0, g_BarnLights_1._m0[_12608]._m9.x, _22154.x) * smoothstep(1.0, g_BarnLights_1._m0[_12608]._m9.y, _22154.y);
                            break;
                        }
                        else
                        {
                            float _11476 = _22154.x;
                            float _15267 = 2.0 / g_BarnLights_1._m0[_12608]._m9.z;
                            float _15020 = _22154.y;
                            float _23041 = (-0.5) * g_BarnLights_1._m0[_12608]._m9.z;
                            float _11981 = (g_BarnLights_1._m0[_12608]._m9.x * g_BarnLights_1._m0[_12608]._m9.y) * pow(max(pow(g_BarnLights_1._m0[_12608]._m9.y * _11476, _15267) + pow(g_BarnLights_1._m0[_12608]._m9.x * _15020, _15267), 1.1754943508222875079687365372222e-38), _23041);
                            float _16524 = pow(max(pow(_11476, _15267) + pow(_15020, _15267), 1.1754943508222875079687365372222e-38), _23041);
                            if (_11981 < _16524)
                            {
                                _10342 = smoothstep(_16524, _11981, 1.0);
                                break;
                            }
                            else
                            {
                                _10342 = float(_16524 > 1.0);
                                break;
                            }
                            break; // unreachable workaround
                        }
                        break; // unreachable workaround
                    } while(false);
                    _21548 = _17828.xyz * _10342;
                }
                else
                {
                    vec3 _12504;
                    if (g_BarnLights_1._m0[_12608]._m4.w < 0.0)
                    {
                        vec4 _17795 = vec4(-g_BarnLights_1._m0[_12608]._m5.xyz, g_BarnLights_1._m0[_12608]._m5.w);
                        vec4 _19008 = _17795.xyzw * vec4(-1.0, -1.0, -1.0, 1.0);
                        vec3 _24990 = _19008.xyz;
                        vec3 _23629 = vec4((-_11179).xyz, 0.0).xyz;
                        float _15156 = -dot(_23629, _24990);
                        vec3 _20479 = vec4((_23629 * _19008.w) + cross(_23629, _24990), _15156).xyz;
                        vec3 _23592 = _17795.xyz;
                        vec3 _12170 = ((_20479 * g_BarnLights_1._m0[_12608]._m5.w) + (_23592 * _15156)) + cross(_23592, _20479);
                        vec3 _14081 = vec3(vec2(atan(_12170.y, -_12170.x) * 0.15915493667125701904296875, acos(_12170.z) * 0.3183098733425140380859375), -g_BarnLights_1._m0[_12608]._m4.w);
                        vec2 _20564 = (_14081.xy * g_BarnLights_1._m0[_12608]._m9.zw) + g_BarnLights_1._m0[_12608]._m9.xy;
                        vec3 _20492 = _14081;
                        _20492.x = _20564.x;
                        _20492.y = _20564.y;
                        _12504 = _17828.xyz * textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightingConstantBufferGpu_t._m30], g_bindless_Sampler[_Globals_.g_sTrilinearWrap]), _20492.xyz, 0.0).xyz;
                    }
                    else
                    {
                        vec3 _13791 = vec3(fma(_22905.xy, vec2(0.5, -0.5), vec2(0.5)), g_BarnLights_1._m0[_12608]._m4.w);
                        vec2 _20563 = (_13791.xy * g_BarnLights_1._m0[_12608]._m9.zw) + g_BarnLights_1._m0[_12608]._m9.xy;
                        vec3 _20491 = _13791;
                        _20491.x = _20563.x;
                        _20491.y = _20563.y;
                        _12504 = _17828.xyz * textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightingConstantBufferGpu_t._m30], g_bindless_Sampler[_Globals_.g_sCookieSampler]), _20491.xyz, 0.0).xyz;
                    }
                    _21548 = _12504;
                }
                if (all(equal(_21548.xyz, vec3(0.0))))
                {
                    _13215 = _13149;
                    _15675 = _16325;
                    break;
                }
                vec3 _21549;
                if (_24419)
                {
                    vec3 _19629;
                    if ((g_BarnLights_1._m0[_12608]._m13 & 4u) != 0u)
                    {
                        vec2 _6281 = _22905.yx * vec2(1.0, -1.0);
                        vec3 _23714 = _21642;
                        _23714.x = _6281.x;
                        _23714.y = _6281.y;
                        _19629 = _23714;
                    }
                    else
                    {
                        _19629 = _21642;
                    }
                    float _24972;
                    do
                    {
                        float _21462 = saturate(_19629.z + PerViewLightingConstantBufferGpu_t._m21);
                        vec2 _10393 = vec3(fma(_19629.xy, g_BarnLights_1._m0[_12608]._m8.zw, g_BarnLights_1._m0[_12608]._m8.xy), _19629.z).xy;
                        float _15312 = dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.z, PerViewLightingConstantBufferGpu_t._m3.z)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.y, PerViewLightingConstantBufferGpu_t._m3.z)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.z, PerViewLightingConstantBufferGpu_t._m3.y)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.y, PerViewLightingConstantBufferGpu_t._m3.y)).xy, _21462), 0.0)).xyzw, vec4(0.25));
                        bool _12894;
                        if (_15312 == 0.0)
                        {
                            _12894 = true;
                        }
                        else
                        {
                            _12894 = _15312 == 1.0;
                        }
                        if (_12894)
                        {
                            _24972 = _15312;
                            break;
                        }
                        _24972 = ((_15312 * (PerViewLightingConstantBufferGpu_t._m0.w * 4.0)) + dot(vec4(textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.z, 0.0)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(PerViewLightingConstantBufferGpu_t._m2.y, 0.0)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(0.0, PerViewLightingConstantBufferGpu_t._m3.y)).xy, _21462), 0.0), textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3((_10393 + vec2(0.0, PerViewLightingConstantBufferGpu_t._m3.z)).xy, _21462), 0.0)).xyzw, PerViewLightingConstantBufferGpu_t._m1.xxxx)) + (textureLod(sampler2DShadow(g_bindless_Texture2D_float4[PerViewLightingConstantBufferGpu_t._m29], g_bindless_Sampler_1[_Globals_.g_tShadowDepthBufferCmpSampler]), vec3(_10393, _21462), 0.0) * PerViewLightingConstantBufferGpu_t._m1.y);
                        break;
                    } while(false);
                    vec3 _19878 = _21548.xyz * mix(1.0, _24972, g_BarnLights_1._m0[_12608]._m12);
                    if (all(equal(_19878.xyz, vec3(0.0))))
                    {
                        _13215 = _13149;
                        _15675 = _16325;
                        break;
                    }
                    _21549 = _19878;
                }
                else
                {
                    _21549 = _21548;
                }
                vec3 _15462 = mix(_17892, _24735, bvec3(all(equal(_17892, vec3(1.0)))));
                float _13812 = max(0.0, dot(_14786.xyz, _11179.xyz));
                vec3 _17875 = vec3(_13812);
                vec3 _18224;
                if (_13694 > 0.0)
                {
                    float _8781 = dot(_15462, _11179.xyz);
                    float _8125 = saturate(_13694);
                    _18224 = mix(_17875.xyz, vec3((((0.5 + (_13812 * 0.5)) + pow(1.0 - saturate(_8781), 4.0)) * saturate((_8781 + 0.20000000298023223876953125) * 4.0)) * saturate(mix(dot(mix(_24735, _15462, vec3(10.0)), _11179.xyz), 1.0, _8125))), vec3(_8125));
                }
                else
                {
                    _18224 = _17875;
                }
                vec2 _17302 = max(_11004, vec2(g_BarnLights_1._m0[_12608]._m11));
                vec3 _21890 = (-normalize(_10061.xyz - PerViewConstantBuffer_t._m7.xyz)).xyz;
                vec3 _12287 = normalize(_11179.xyz + _21890).xyz;
                vec3 _19014 = _15462.xyz;
                float _12387 = dot(_12287, _19014);
                float _25074 = max(0.0, dot(_19014, _21890));
                vec3 _22997 = _9451.xyz;
                float _9851 = _17302.x;
                float _25212 = _9851 * _9851;
                float _19098 = _12387 * _12387;
                float _24199 = _25212 / ((_19098 * ((_25212 * _25212) - 1.0)) + 1.0);
                float _16151 = _9851 + 1.0;
                float _6836 = (_16151 * _16151) * 0.125;
                float _19571 = 1.0 - _6836;
                float _21625 = (_24199 * _24199) / ((4.0 * ((_13812 * _19571) + _6836)) * ((_25074 * _19571) + _6836));
                float _11622;
                SPIRV_CROSS_BRANCH
                if (_14875)
                {
                    float _6598 = dot(_17302.xy, vec2(0.5));
                    float _20792 = max(_6598 * _6598, 9.9999997473787516355514526367188e-06);
                    float _21402 = saturate(_25074 + 0.001000000047497451305389404296875);
                    _11622 = mix(_21625, ((((2.0 + (1.0 / _20792)) * pow(1.0 - _19098, 0.5 / _20792)) / ((_13812 + _21402) - (_13812 * _21402))) * 0.124999918043613433837890625) * _13812, _17115);
                }
                else
                {
                    _11622 = _21625;
                }
                vec3 _16572 = ((_22997 + ((vec3(1.0) - _22997) * pow(max(9.9999999747524270787835121154785e-07, 1.0 - max(0.0, dot(_11179.xyz, _12287))), 5.0))) * _11622).xyz * _13812;
                vec3 _9982;
                vec3 _22798;
                if (_24468.w)
                {
                    float _22998 = smoothstep(0.0, 1.0, saturate(dot(_24735, _11179.xyz) / sqrt(max(1.0 - _16312, 9.9999997473787516355514526367188e-06))));
                    _9982 = _16572 * _22998;
                    _22798 = _18224 * _22998;
                }
                else
                {
                    _9982 = _16572;
                    _22798 = _18224;
                }
                _13215 = _13149.xyz + (_9982.xyz * _21549.xyz);
                _15675 = _16325.xyz + (_22798.xyz * _21549.xyz);
                break;
            } while(false);
            _13149 = _13215;
            _16325 = _15675;
            _17018 = _20344;
            continue;
        }
        _21567 = _17017 + 1u;
        _13148 = _16325;
        _16324 = _13149;
        _17017 = _21567;
        continue;
    }
    vec3 _10146 = normalize(_10061.xyz - PerViewConstantBuffer_t._m7.xyz);
    vec3 _19257 = -_10146;
    float _17138 = _11004.x + _11004.y;
    float _19582 = _17138 * _17138;
    vec3 _22447 = vec3(1.0) + (_9451 * ((0.125 * (_19582 * _19582)) * saturate(dot(_17892, _19257))));
    vec3 _10287;
    SPIRV_CROSS_BRANCH
    if (_14875)
    {
        _10287 = mix(_22447, vec3(1.0), vec3(_17115));
    }
    else
    {
        _10287 = _22447;
    }
    float _17751 = dot(_11004.xy, vec2(0.5));
    vec3 _6521 = _17892.xyz;
    vec3 _12148 = _10146.xyz;
    vec3 _19081 = _17892.xyz;
    float _12853 = PerViewLightingConstantBufferGpu_t._m15.y * sqrt(_17751);
    vec3 _11901 = _10061.xyz;
    bool _11913 = PerViewConstantBufferCsgo_t._m29 != 0.0;
    vec3 _11008;
    vec4 _14444;
    if (_11913)
    {
        float _9642 = dot(vec4(((_11901 + PerViewConstantBuffer_t._m6.xyz) + ((-PerViewConstantBuffer_t._m8) * PerViewConstantBufferCsgo_t._m29)).xyz, 1.0), vec4(PerViewConstantBuffer_t._m8.xyz, dot((PerViewConstantBuffer_t._m6.xyz + PerViewConstantBuffer_t._m7.xyz).xyz + (PerViewConstantBuffer_t._m8.xyz * PerViewConstantBuffer_t._m5), PerViewConstantBuffer_t._m8.xyz)));
        vec3 _21716;
        if (_9642 <= 0.0)
        {
            _21716 = _10061;
        }
        else
        {
            _21716 = _11901 + ((-PerViewConstantBuffer_t._m8.xyz) * _9642);
        }
        vec4 _19975 = vec4(_21716.xyz, 1.0) * PerViewConstantBufferCsgo_t._m15;
        float _20177 = _19975.w;
        vec2 _11415 = _19975.xy / vec2(_20177);
        vec4 _6652;
        _6652.x = clamp(((_11415.x + 1.0) * PerViewConstantBuffer_t._m3.x) * 0.5, 0.0, PerViewConstantBuffer_t._m3.x - 1.0);
        _6652.y = clamp(((1.0 - _11415.y) * PerViewConstantBuffer_t._m3.y) * 0.5, 0.0, PerViewConstantBuffer_t._m3.y - 1.0);
        _6652.w = _20177;
        _11008 = _21716;
        _14444 = _6652;
    }
    else
    {
        _11008 = _11901;
        _14444 = _11408.xyzw;
    }
    float _22046 = _17751 * _17751;
    float _20711 = saturate(1.0 - _22046);
    vec3 _25271 = normalize(mix(_6521, reflect(_12148, _19081).xyz, vec3(_20711 * (sqrt(_20711) + _22046))));
    uvec2 _6814 = uvec2(_14444.xy - PerViewConstantBuffer_t._m2.xy) >> _7663;
    uint _12130 = PerViewLightingConstantBufferGpu_t._m11.y + (((_6814.y * PerViewLightingConstantBufferGpu_t._m13.y) + _6814.x) * PerViewLightingConstantBufferGpu_t._m11.z);
    uint _23394 = PerViewLightingConstantBufferGpu_t._m11.x + (uint(clamp(_14444.w * PerViewLightingConstantBufferGpu_t._m14.x, 0.0, PerViewLightingConstantBufferGpu_t._m14.y)) * PerViewLightingConstantBufferGpu_t._m11.z);
    vec4 _13150;
    float _16313;
    vec3 _17129;
    _13150 = vec4(0.0);
    _16313 = 0.00999999977648258209228515625;
    _17129 = vec3(0.0);
    uint _8896;
    vec4 _13157;
    vec3 _14891;
    float _16315;
    bool _18379;
    uint _17020 = 0u;
    bool _17133 = false;
    for (;;)
    {
        bool _12895;
        if (_17020 < PerViewLightingConstantBufferGpu_t._m11.z)
        {
            _12895 = !_17133;
        }
        else
        {
            _12895 = false;
        }
        if (!_12895)
        {
            break;
        }
        uint _14476 = subgroupOr(g_CullBits_1._m0[_12130 + _17020] & g_CullBits_1._m0[_23394 + _17020]);
        vec3 _13154;
        vec4 _16314;
        _13154 = _17129;
        _16314 = _13150;
        uint _10154;
        vec3 _13155;
        vec4 _16381;
        float _16482;
        uint _17021 = _14476;
        float _17134 = _16313;
        for (;;)
        {
            if (!(_17021 != 0u))
            {
                _13157 = _16314;
                _16315 = _17134;
                _14891 = _13154;
                _18379 = _17133;
                break;
            }
            uint _18154 = uint(findLSB(_17021));
            int _12609 = int(_18154 + (_17020 * 32u));
            _10154 = _17021 & (_17021 - 1u);
            vec3 _7748 = (PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m0 * vec4(_11008.xyz, 1.0)).xyz;
            vec3 _8793 = saturate((_7748 - PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m1) * PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m5.xyz);
            vec3 _19654 = saturate((PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m3 - _7748) * PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m5.xyz);
            float _17265 = min(min(_8793.x, min(_8793.y, _8793.z)), min(_19654.x, min(_19654.y, _19654.z)));
            if (_17265 == 0.0)
            {
                _13155 = _13154;
                _16381 = _16314;
                _16482 = _17134;
                _13154 = _13155;
                _16314 = _16381;
                _17134 = _16482;
                _17021 = _10154;
                continue;
            }
            vec3 _19630;
            if (PerViewConstantBufferCsgo_t._m28 != 0.0)
            {
                vec3 _19779 = PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m1 + ((PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m3 - PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m1) * 0.5);
                _19630 = ((_7748 - _19779) * PerViewConstantBufferCsgo_t._m28) + _19779;
            }
            else
            {
                _19630 = _7748;
            }
            vec3 _7648 = (PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m0 * vec4(_25271.xyz, 0.0)).xyz;
            vec3 _11253 = max(((PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m3.xyz - _19630.xyz) / _7648).xyz, ((PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m1.xyz - _19630.xyz) / _7648).xyz);
            float _11076 = ((_17265 * _17265) * (((-2.0) * _17265) + 3.0)) * (1.0 - _17134);
            float _13713 = _17134 + _11076;
            vec3 _15431 = _13154 + ((textureLod(samplerCubeArray(g_bindless_TextureCubeArray[PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m4], g_bindless_Sampler[_Globals_.g_sTrilinearWrap]), vec4(mix(_19630.xyz + (_7648 * abs(min(_11253.x, min(_11253.y, _11253.z)))), _7648, vec3(_17751)).xyz, float(PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m2)), _12853).xyz * PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m6) * _11076);
            vec4 _7463 = _16314 + (PerViewLightingConstantBufferGpu_t._m16._m0[_12609]._m7 * _11076);
            if (_13713 > 0.9900000095367431640625)
            {
                _13157 = _7463;
                _16315 = _13713;
                _14891 = _15431;
                _18379 = true;
                break;
            }
            _13155 = _15431;
            _16381 = _7463;
            _16482 = _13713;
            _13154 = _13155;
            _16314 = _16381;
            _17134 = _16482;
            _17021 = _10154;
            continue;
        }
        _8896 = _17020 + 1u;
        _13150 = _13157;
        _16313 = _16315;
        _17129 = _14891;
        _17133 = _18379;
        _17020 = _8896;
        continue;
    }
    vec3 _20869 = _19257.xyz;
    float _20784 = max(0.0, dot(_20869, _6521));
    vec4 _11487 = textureLod(sampler2DArray(g_bindless_Texture2DArray_float4[PerViewConstantBufferCsgo_t._m5], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), vec3((vec2(_17751, sqrt(1.0 - _20784)) * 0.984375) + vec2(0.0078125), 1.0).xyz, 0.0);
    vec3 _18985 = mix(_11487.xxx, _11487.yyy, _9451);
    float _10020;
    vec3 _23440;
    SPIRV_CROSS_BRANCH
    if (_14875)
    {
        float _7173 = dot(normalize(_6521 + _20869).xyz, _6521);
        float _22187 = max(_22046, 9.9999997473787516355514526367188e-06);
        float _21363 = saturate(_20784 + 0.001000000047497451305389404296875);
        _10020 = 1.0 - _17115;
        _23440 = mix(_18985, _9451 * ((((2.0 + (1.0 / _22187)) * pow(1.0 - (_7173 * _7173), 0.5 / _22187)) / ((1.0 + _21363) - _21363)) * 0.124999918043613433837890625), vec3(_17115));
    }
    else
    {
        _10020 = 1.0;
        _23440 = _18985;
    }
    float _8840 = 1.0 - _11487.y;
    vec3 _15517 = _9451 + ((vec3(1.0) - _9451) * vec3(0.0476190485060214996337890625));
    vec3 _20883 = ((_23440 * _15517) / (vec3(1.0) - (_15517 * _8840))) * _8840;
    vec3 _13436 = vec3(_21714 * _16312).xyz;
    vec3 _22686 = (_13148.xyz + ((_18708 * mix(vec3(1.0), vec3(1.0) - (_23440 + _20883), vec3(_10020))).xyz * _13436).xyz) * (_17128.xyz * (1.0 - _13999)).xyz;
    vec4 _11205 = vec4(_22686, _17127);
    _11205.x = _22686.x;
    _11205.y = _22686.y;
    _11205.z = _22686.z;
    vec3 _15752 = _11205.xyz + ((_16324 * _10287).xyz * _13436).xyz;
    vec4 _20493 = _11205;
    _20493.x = _15752.x;
    _20493.y = _15752.y;
    _20493.z = _15752.z;
    vec3 _15736 = _20493.xyz + ((((_17129 / vec3(_16313)).xyz * min(dot(_18708.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)) / dot(vec4(_19081, 1.0), (_13150 / vec4(_16313)).xyzw), max((_17751 * PerViewLightingConstantBufferGpu_t._m4.x) + PerViewLightingConstantBufferGpu_t._m4.y, 1.0))).xyz * (_23440 + (_20883 * _10020))).xyz * _13436).xyz;
    vec4 _13888 = _20493;
    _13888.x = _15736.x;
    _13888.y = _15736.y;
    _13888.z = _15736.z;
    vec4 _12898;
    if (_Globals_.g_bFogEnabled != 0)
    {
        vec3 _21493;
        vec3 _23187 = _11901 - PerViewConstantBuffer_t._m7.xyz;
        vec3 _9057 = _23187.xyz;
        vec3 _19341;
        do
        {
            _21493 = _23187.xyz;
            bool _12896;
            if (dot(_21493, _21493) > PerViewConstantBufferCsgo_t._m21.x)
            {
                _12896 = (_10061.z * PerViewConstantBufferCsgo_t._m21.z) < PerViewConstantBufferCsgo_t._m21.y;
            }
            else
            {
                _12896 = false;
            }
            SPIRV_CROSS_BRANCH
            if (_12896)
            {
                float _16579 = length(_21493);
                vec2 _9342 = saturate(PerViewConstantBufferCsgo_t._m18.xy + (PerViewConstantBufferCsgo_t._m18.zw * vec2(mix(_16579, _16579 * PerViewConstantBufferCsgo_t._m31.y, _Globals_.g_flFogModificationAmount), _10061.z)));
                float _13533 = (pow(_9342.x, PerViewConstantBufferCsgo_t._m19.x) * pow(_9342.y, PerViewConstantBufferCsgo_t._m19.y)) * PerViewConstantBufferCsgo_t._m20.w;
                float _12715 = mix(_13533, _13533 * PerViewConstantBufferCsgo_t._m31.z, _Globals_.g_flFogModificationAmount);
                _19341 = mix(_13888.xyz, vec4(PerViewConstantBufferCsgo_t._m20.xyz, _12715).xyz, vec3(_12715));
                break;
            }
            _19341 = _13888.xyz;
            break;
        } while(false);
        vec4 _23944 = _13888;
        _23944.x = _19341.x;
        _23944.y = _19341.y;
        _23944.z = _19341.z;
        vec3 _19342;
        do
        {
            bool _12897;
            if (dot(_9057, _9057) > PerViewConstantBufferCsgo_t._m25.x)
            {
                _12897 = (PerViewConstantBufferCsgo_t._m25.z * _10061.z) < PerViewConstantBufferCsgo_t._m25.y;
            }
            else
            {
                _12897 = false;
            }
            if (_12897)
            {
                float _16580 = length(_21493);
                float _14602 = saturate(pow(max(0.0, (mix(_16580, _16580 * PerViewConstantBufferCsgo_t._m31.y, _Globals_.g_flFogModificationAmount) * PerViewConstantBufferCsgo_t._m22.y) + PerViewConstantBufferCsgo_t._m22.x), PerViewConstantBufferCsgo_t._m22.w)) * saturate(pow(max(0.0, (_10061.z * PerViewConstantBufferCsgo_t._m23.y) + PerViewConstantBufferCsgo_t._m23.x), PerViewConstantBufferCsgo_t._m23.z));
                float _16973 = saturate(_14602) * mix(PerViewConstantBufferCsgo_t._m25.w, PerViewConstantBufferCsgo_t._m25.w * PerViewConstantBufferCsgo_t._m31.z, _Globals_.g_flFogModificationAmount);
                _19342 = mix(_23944.xyz, vec4((textureLod(samplerCube(g_bindless_TextureCube_float4[PerViewConstantBufferCsgo_t._m6], g_bindless_Sampler[_Globals_.g_sTrilinearClamp]), normalize((PerViewConstantBufferCsgo_t._m24 * vec4(_9057, 0.0)).xyz).xyz, PerViewConstantBufferCsgo_t._m23.w * saturate(1.0 - (_14602 * PerViewConstantBufferCsgo_t._m22.z))) * PerViewConstantBufferCsgo_t._m26.x).xyz, _16973).xyz, vec3(_16973));
                break;
            }
            _19342 = _23944.xyz;
            break;
        } while(false);
        _23944.x = _19342.x;
        _23944.y = _19342.y;
        _23944.z = _19342.z;
        _12898 = _23944;
    }
    else
    {
        _12898 = _13888;
    }
    bool _12899;
    if (_10513)
    {
        _12899 = _21712 > 400.0;
    }
    else
    {
        _12899 = false;
    }
    vec4 _21722;
    SPIRV_CROSS_BRANCH
    if (_12899)
    {
        float _6967 = dot(_Globals_.g_vAvgAlbedo.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
        bool _14881 = _Globals_.g_bDistanceContrastAdjustment != 0;
        float _14796;
        SPIRV_CROSS_BRANCH
        if (_14881)
        {
            _14796 = max(_Globals_.g_fDistanceContrastExposure, _6967);
        }
        else
        {
            _14796 = _6967;
        }
        float _9018 = max(_14796, 0.001000000047497451305389404296875);
        vec3 _3295 = _Globals_.g_vAvgAlbedo.xyz / vec3(_9018);
        float _8491 = _3295.x;
        float _7521 = _3295.y;
        float _6866 = _3295.z;
        float _19393 = max(max(_8491, _7521), _6866);
        float _8757 = min(min(_8491, _7521), _6866);
        vec3 _10021;
        vec4 _22452;
        if (_11913)
        {
            float _9643 = dot(vec4(((_11901 + PerViewConstantBuffer_t._m6.xyz) + ((-PerViewConstantBuffer_t._m8) * PerViewConstantBufferCsgo_t._m29)).xyz, 1.0), vec4(PerViewConstantBuffer_t._m8.xyz, dot((PerViewConstantBuffer_t._m6.xyz + PerViewConstantBuffer_t._m7.xyz).xyz + (PerViewConstantBuffer_t._m8.xyz * PerViewConstantBuffer_t._m5), PerViewConstantBuffer_t._m8.xyz)));
            vec3 _21720;
            if (_9643 <= 0.0)
            {
                _21720 = _10061;
            }
            else
            {
                _21720 = _11901 + ((-PerViewConstantBuffer_t._m8.xyz) * _9643);
            }
            vec4 _19976 = vec4(_21720.xyz, 1.0) * PerViewConstantBufferCsgo_t._m15;
            float _20178 = _19976.w;
            vec2 _11416 = _19976.xy / vec2(_20178);
            vec4 _6653;
            _6653.x = clamp(((_11416.x + 1.0) * PerViewConstantBuffer_t._m3.x) * 0.5, 0.0, PerViewConstantBuffer_t._m3.x - 1.0);
            _6653.y = clamp(((1.0 - _11416.y) * PerViewConstantBuffer_t._m3.y) * 0.5, 0.0, PerViewConstantBuffer_t._m3.y - 1.0);
            _6653.w = _20178;
            _10021 = _21720;
            _22452 = _6653;
        }
        else
        {
            _10021 = _11901;
            _22452 = _11408.xyzw;
        }
        uvec2 _6815 = uvec2(_22452.xy - PerViewConstantBuffer_t._m2.xy) >> _7663;
        uint _19949 = PerViewLightingConstantBufferGpu_t._m12.y + (((_6815.y * PerViewLightingConstantBufferGpu_t._m13.y) + _6815.x) * PerViewLightingConstantBufferGpu_t._m12.z);
        uint _23395 = PerViewLightingConstantBufferGpu_t._m12.x + (uint(clamp(_22452.w * PerViewLightingConstantBufferGpu_t._m14.x, 0.0, PerViewLightingConstantBufferGpu_t._m14.y)) * PerViewLightingConstantBufferGpu_t._m12.z);
        vec3 _13158;
        float _16316;
        _13158 = vec3(0.0);
        _16316 = 0.0;
        uint _8897;
        vec3 _13160;
        float _14082;
        bool _18380;
        uint _17022 = 0u;
        bool _17135 = false;
        for (;;)
        {
            bool _12900;
            if (_17022 < PerViewLightingConstantBufferGpu_t._m12.z)
            {
                _12900 = !_17135;
            }
            else
            {
                _12900 = false;
            }
            if (!_12900)
            {
                break;
            }
            uint _14477 = subgroupOr(g_CullBits_1._m0[_19949 + _17022] & g_CullBits_1._m0[_23395 + _17022]);
            vec3 _13159;
            _13159 = _13158;
            uint _10155;
            vec3 _13216;
            float _15677;
            float _16326 = _16316;
            uint _17023 = _14477;
            for (;;)
            {
                if (!(_17023 != 0u))
                {
                    _13160 = _13159;
                    _14082 = _16326;
                    _18380 = _17135;
                    break;
                }
                uint _18155 = uint(findLSB(_17023));
                int _12610 = int(_18155 + (_17022 * 32u));
                _10155 = _17023 & (_17023 - 1u);
                vec4 _19087 = vec4(_10021.xyz, 1.0);
                vec3 _15472 = (PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m0 * _19087).xyz;
                vec3 _7194 = saturate((_15472 - PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m1.xyz) * PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m3);
                vec3 _19655 = saturate((PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m2.xyz - _15472) * PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m3);
                float _17266 = min(min(_7194.x, min(_7194.y, _7194.z)), min(_19655.x, min(_19655.y, _19655.z)));
                if (_17266 == 0.0)
                {
                    _13216 = _13159;
                    _15677 = _16326;
                    _13159 = _13216;
                    _16326 = _15677;
                    _17023 = _10155;
                    continue;
                }
                float _9614 = ((_17266 * _17266) * (((-2.0) * _17266) + 3.0)) * (1.0 - _16326);
                float _6671 = _16326 + _9614;
                vec3 _24894 = PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m0 * _19087;
                vec3 _6343 = _24894.xyz;
                _6343.z = _24894.z * 0.16666667163372039794921875;
                vec3 _19423 = clamp(_6343.xyz, PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m1, PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m2);
                _19423.z = _19423.z * 6.0;
                vec3 _23126 = (_19423.xyz * PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m5).xyz + PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m6;
                _23126.z = _23126.z * 0.16666667163372039794921875;
                vec3 _17331 = _10146.xyz;
                vec3 _15791 = mix(vec3(0.0, 0.16666667163372039794921875, 0.3333333432674407958984375), vec3(0.5, 0.666666686534881591796875, 0.833333313465118408203125), step(_17331, vec3(0.0)).xyz);
                vec3 _18910 = _17331 * _17331;
                vec3 _13872 = _13159 + (((((textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23126.xyz + vec3(0.0, 0.0, _15791.x), 0.0).xyz * _18910.x) + (textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23126.xyz + vec3(0.0, 0.0, _15791.y), 0.0).xyz * _18910.y)) + (textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23126.xyz + vec3(0.0, 0.0, _15791.z), 0.0).xyz * _18910.z)).xyz * PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12610]._m4]._m4.xyz) * _9614);
                if (_6671 > 0.9900000095367431640625)
                {
                    _13160 = _13872;
                    _14082 = _6671;
                    _18380 = true;
                    break;
                }
                _13216 = _13872;
                _15677 = _6671;
                _13159 = _13216;
                _16326 = _15677;
                _17023 = _10155;
                continue;
            }
            _8897 = _17022 + 1u;
            _13158 = _13160;
            _16316 = _14082;
            _17135 = _18380;
            _17022 = _8897;
            continue;
        }
        vec3 _20940;
        if (_16316 < 0.9900000095367431640625)
        {
            vec4 _16034 = vec4(_10146.xyz, 1.0);
            _20940 = _13158 + (vec3(dot(PerViewLightingConstantBufferGpu_t._m5._m0[0].xyzw, _16034), dot(PerViewLightingConstantBufferGpu_t._m5._m0[1].xyzw, _16034), dot(PerViewLightingConstantBufferGpu_t._m5._m0[2].xyzw, _16034)) * (1.0 - _16316));
        }
        else
        {
            _20940 = _13158;
        }
        vec3 _16025 = -_12148;
        vec3 _10022;
        vec4 _22460;
        if (_11913)
        {
            float _9644 = dot(vec4(((_11901 + PerViewConstantBuffer_t._m6.xyz) + ((-PerViewConstantBuffer_t._m8) * PerViewConstantBufferCsgo_t._m29)).xyz, 1.0), vec4(PerViewConstantBuffer_t._m8.xyz, dot((PerViewConstantBuffer_t._m6.xyz + PerViewConstantBuffer_t._m7.xyz).xyz + (PerViewConstantBuffer_t._m8.xyz * PerViewConstantBuffer_t._m5), PerViewConstantBuffer_t._m8.xyz)));
            vec3 _21721;
            if (_9644 <= 0.0)
            {
                _21721 = _10061;
            }
            else
            {
                _21721 = _11901 + ((-PerViewConstantBuffer_t._m8.xyz) * _9644);
            }
            vec4 _19977 = vec4(_21721.xyz, 1.0) * PerViewConstantBufferCsgo_t._m15;
            float _20179 = _19977.w;
            vec2 _11418 = _19977.xy / vec2(_20179);
            vec4 _6654;
            _6654.x = clamp(((_11418.x + 1.0) * PerViewConstantBuffer_t._m3.x) * 0.5, 0.0, PerViewConstantBuffer_t._m3.x - 1.0);
            _6654.y = clamp(((1.0 - _11418.y) * PerViewConstantBuffer_t._m3.y) * 0.5, 0.0, PerViewConstantBuffer_t._m3.y - 1.0);
            _6654.w = _20179;
            _10022 = _21721;
            _22460 = _6654;
        }
        else
        {
            _10022 = _11901;
            _22460 = _11408.xyzw;
        }
        uvec2 _6816 = uvec2(_22460.xy - PerViewConstantBuffer_t._m2.xy) >> _7663;
        uint _22341 = PerViewLightingConstantBufferGpu_t._m12.y + (((_6816.y * PerViewLightingConstantBufferGpu_t._m13.y) + _6816.x) * PerViewLightingConstantBufferGpu_t._m12.z);
        uint _7533 = PerViewLightingConstantBufferGpu_t._m12.x + (uint(clamp(_22460.w * PerViewLightingConstantBufferGpu_t._m14.x, 0.0, PerViewLightingConstantBufferGpu_t._m14.y)) * PerViewLightingConstantBufferGpu_t._m12.z);
        vec3 _13161;
        float _16317;
        _13161 = vec3(0.0);
        _16317 = 0.0;
        uint _8898;
        vec3 _13163;
        float _14083;
        bool _18382;
        uint _17024 = 0u;
        bool _17136 = false;
        for (;;)
        {
            bool _12901;
            if (_17024 < PerViewLightingConstantBufferGpu_t._m12.z)
            {
                _12901 = !_17136;
            }
            else
            {
                _12901 = false;
            }
            if (!_12901)
            {
                break;
            }
            uint _14478 = subgroupOr(g_CullBits_1._m0[_22341 + _17024] & g_CullBits_1._m0[_7533 + _17024]);
            vec3 _13162;
            _13162 = _13161;
            uint _10156;
            vec3 _13217;
            float _15678;
            float _16327 = _16317;
            uint _17025 = _14478;
            for (;;)
            {
                if (!(_17025 != 0u))
                {
                    _13163 = _13162;
                    _14083 = _16327;
                    _18382 = _17136;
                    break;
                }
                uint _18159 = uint(findLSB(_17025));
                int _12611 = int(_18159 + (_17024 * 32u));
                _10156 = _17025 & (_17025 - 1u);
                vec4 _19088 = vec4(_10022.xyz, 1.0);
                vec3 _15473 = (PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m0 * _19088).xyz;
                vec3 _7195 = saturate((_15473 - PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m1.xyz) * PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m3);
                vec3 _19656 = saturate((PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m2.xyz - _15473) * PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m3);
                float _17267 = min(min(_7195.x, min(_7195.y, _7195.z)), min(_19656.x, min(_19656.y, _19656.z)));
                if (_17267 == 0.0)
                {
                    _13217 = _13162;
                    _15678 = _16327;
                    _13162 = _13217;
                    _16327 = _15678;
                    _17025 = _10156;
                    continue;
                }
                float _9615 = ((_17267 * _17267) * (((-2.0) * _17267) + 3.0)) * (1.0 - _16327);
                float _6672 = _16327 + _9615;
                vec3 _24895 = PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m0 * _19088;
                vec3 _6345 = _24895.xyz;
                _6345.z = _24895.z * 0.16666667163372039794921875;
                vec3 _19428 = clamp(_6345.xyz, PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m1, PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m2);
                _19428.z = _19428.z * 6.0;
                vec3 _23127 = (_19428.xyz * PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m5).xyz + PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m6;
                _23127.z = _23127.z * 0.16666667163372039794921875;
                vec3 _17332 = _16025.xyz;
                vec3 _15792 = mix(vec3(0.0, 0.16666667163372039794921875, 0.3333333432674407958984375), vec3(0.5, 0.666666686534881591796875, 0.833333313465118408203125), step(_17332, vec3(0.0)).xyz);
                vec3 _18911 = _17332 * _17332;
                vec3 _13873 = _13162 + (((((textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23127.xyz + vec3(0.0, 0.0, _15792.x), 0.0).xyz * _18911.x) + (textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23127.xyz + vec3(0.0, 0.0, _15792.y), 0.0).xyz * _18911.y)) + (textureLod(sampler3D(g_bindless_Texture3D_float4[PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m3], g_bindless_Sampler[_Globals_.g_sBilinearClamp]), _23127.xyz + vec3(0.0, 0.0, _15792.z), 0.0).xyz * _18911.z)).xyz * PerViewLightProbeVolumeConstantBuffer_t._m0._m0[PerViewLightingConstantBufferGpu_t._m17._m0[_12611]._m4]._m4.xyz) * _9615);
                if (_6672 > 0.9900000095367431640625)
                {
                    _13163 = _13873;
                    _14083 = _6672;
                    _18382 = true;
                    break;
                }
                _13217 = _13873;
                _15678 = _6672;
                _13162 = _13217;
                _16327 = _15678;
                _17025 = _10156;
                continue;
            }
            _8898 = _17024 + 1u;
            _13161 = _13163;
            _16317 = _14083;
            _17136 = _18382;
            _17024 = _8898;
            continue;
        }
        vec3 _20941;
        if (_16317 < 0.9900000095367431640625)
        {
            vec4 _16035 = vec4(_16025.xyz, 1.0);
            _20941 = _13161 + (vec3(dot(PerViewLightingConstantBufferGpu_t._m5._m0[0].xyzw, _16035), dot(PerViewLightingConstantBufferGpu_t._m5._m0[1].xyzw, _16035), dot(PerViewLightingConstantBufferGpu_t._m5._m0[2].xyzw, _16035)) * (1.0 - _16317));
        }
        else
        {
            _20941 = _13161;
        }
        float _18268 = dot(_17128.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125));
        float _9680;
        if (_14881)
        {
            _9680 = _Globals_.g_fDistanceContrastExposure;
        }
        else
        {
            _9680 = 1.0;
        }
        vec3 _10929 = mix(_12898.xyz, min(vec3(1.0), (_12898.xyz * (((smoothstep(0.0, _9018, _18268) * 0.5) + (smoothstep(_9018, _9018 + 0.1500000059604644775390625, _18268) * 0.5)) * (2.0 + (smoothstep(0.5, 0.0, abs((saturate(dot(_20941.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))) * _9018) - saturate(dot(_20940.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125))))) * 2.0)))) * mix(_3295, vec3(1.0), vec3(smoothstep(0.449999988079071044921875, 0.550000011920928955078125, (_19393 - _8757) / (_19393 + _8757))))) + (max(vec3(0.0), _12898.xyz - vec3(1.0)) * _9680), vec3((min(0.800000011920928955078125, PerViewConstantBufferCsgo_t._m31.x) * smoothstep(400.0, 1400.0, _21712)) * _Globals_.g_flFogModificationAmount));
        vec4 _17842 = _12898;
        _17842.x = _10929.x;
        _17842.y = _10929.y;
        _17842.z = _10929.z;
        _21722 = _17842;
    }
    else
    {
        _21722 = _12898;
    }
    vec4 _23728;
    if (any(notEqual(_Globals_.g_vLastDecalPosOs.xyz, vec3(0.0))))
    {
        vec3 _17130 = _Globals_.g_vLastDecalPosOs.xyz - (_Globals_.g_vLastDecalNrmOs.xyz * 2.0);
        vec3 _11699 = _Globals_.g_vLastDecalPosOs.xyz + (_Globals_.g_vLastDecalNrmOs.xyz * 100.0);
        vec3 _6894;
        do
        {
            vec3 _19537 = _11699 - _17130;
            float _11853 = dot(input_0.xyz - _17130, _19537);
            if (_11853 <= 0.0)
            {
                _6894 = _17130;
                break;
            }
            else
            {
                float _21155 = dot(_19537, _19537);
                if (_11853 > _21155)
                {
                    _6894 = _11699;
                    break;
                }
                else
                {
                    _6894 = _17130 + (_19537 * (_11853 / _21155));
                    break;
                }
                break; // unreachable workaround
            }
            break; // unreachable workaround
        } while(false);
        float _16619 = smoothstep((saturate((distance(_11901, PerViewConstantBuffer_t._m7.xyz) - 100.0) * 0.0011111111380159854888916015625) * 2.2999999523162841796875) + 0.699999988079071044921875, 0.0, distance(input_0.xyz, _6894));
        vec3 _10930 = mix(_21722.xyz, vec3(100.0, 95.0, 47.0), vec3((_16619 * _16619) * ((saturate((PerViewConstantBuffer_t._m1 - _Globals_.g_flLastDecalTime) * 6.666666507720947265625) * (-1.0)) + 1.0)));
        vec4 _17843 = _21722;
        _17843.x = _10930.x;
        _17843.y = _10930.y;
        _17843.z = _10930.z;
        _23728 = _17843;
    }
    else
    {
        _23728 = _21722;
    }
    if (input_4.w < 1.0)
    {
        if ((fma(input_4.w, 2.0, -1.5) + texelFetch(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m4], ivec3(ivec2(_11408.xy) & PerViewConstantBufferCsgo_t._m14, 0).xy, 0).y) < 0.0)
        {
            discard;
        }
    }
    vec3 _19343;
    if (_Globals_.g_flSpawnInvulnerability > 0.0)
    {
        float _11148 = 1.0 - saturate(dot(_19257, _24735));
        _19343 = mix(_23728.xyz, _Globals_.g_cInvulnerabilityColor * (mix(dot(_23728.xyz, vec3(0.2125000059604644775390625, 0.7153999805450439453125, 0.07209999859333038330078125)), 0.5, 0.5) + (4.0 * pow(mix(_11148 * texelFetch(g_bindless_Texture2D_float4[PerViewConstantBufferCsgo_t._m4], ivec3(ivec2(_11408.xy) & PerViewConstantBufferCsgo_t._m14, 0).xy, 0).y, 1.0, _11148), mix(3.0, 6.0, 1.0 + (sin(PerViewConstantBuffer_t._m1 * 20.0) * 0.5))))), vec3(_Globals_.g_flSpawnInvulnerability));
    }
    else
    {
        _19343 = _23728.xyz;
    }
    vec4 _23946 = _23728;
    _23946.x = _19343.x;
    _23946.y = _19343.y;
    _23946.z = _19343.z;
    output_0 = _23946;
}


