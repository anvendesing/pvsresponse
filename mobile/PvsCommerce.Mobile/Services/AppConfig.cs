using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PvsCommerce.Mobile.Services;

// Per-platform configuration with runtime override.
//
// Defaults assume a Debug session against a backend started on the developer
// machine. On a real phone the user must override ApiBaseUrl with the host's
// LAN IP (e.g. http://192.168.1.10:4000/v1). The override is persisted as
// {LocalAppData}/PvsCommerce/api.json so it survives app restarts and can be
// edited from the in-app Settings screen.
public sealed class AppConfig
{
    private const string FileName = "api.json";

    public string ApiBaseUrl { get; private set; } =
#if ANDROID
        "http://10.0.2.2:4000/v1";
#else
        "http://localhost:4000/v1";
#endif

    public string ImageOrigin { get; private set; } =
#if ANDROID
        "http://10.0.2.2:4000";
#else
        "http://localhost:4000";
#endif

    public AppConfig()
    {
        TryLoadOverride();
    }

    private static string GetSettingsPath()
    {
        var d = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(d)) d = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        var dir = Path.Combine(d, "PvsCommerce");
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, FileName);
    }

    private void TryLoadOverride()
    {
        try
        {
            var path = GetSettingsPath();
            if (!File.Exists(path)) return;
            var json = File.ReadAllText(path);
            var stored = JsonSerializer.Deserialize(json, ConfigJsonContext.Default.StoredConfig);
            if (stored is null) return;
            if (!string.IsNullOrWhiteSpace(stored.ApiBaseUrl))
                ApiBaseUrl = stored.ApiBaseUrl!.TrimEnd('/');
            if (!string.IsNullOrWhiteSpace(stored.ImageOrigin))
                ImageOrigin = stored.ImageOrigin!.TrimEnd('/');
        }
        catch { /* corrupt or unreadable - fall back to defaults */ }
    }

    // Persist a new URL. Caller is responsible for restarting any HttpClient
    // that already captured the old BaseAddress.
    public void SaveOverride(string apiBaseUrl)
    {
        var trimmed = apiBaseUrl.TrimEnd('/');
        ApiBaseUrl = trimmed;
        // Derive image origin by stripping the trailing /v1 segment
        ImageOrigin = trimmed.EndsWith("/v1", StringComparison.OrdinalIgnoreCase)
            ? trimmed[..^3]
            : trimmed;
        try
        {
            var stored = new StoredConfig { ApiBaseUrl = ApiBaseUrl, ImageOrigin = ImageOrigin };
            var json = JsonSerializer.Serialize(stored, ConfigJsonContext.Default.StoredConfig);
            File.WriteAllText(GetSettingsPath(), json);
        }
        catch { /* best-effort; in-memory update still applies */ }
    }
}

internal sealed class StoredConfig
{
    [JsonPropertyName("apiBaseUrl")] public string? ApiBaseUrl { get; set; }
    [JsonPropertyName("imageOrigin")] public string? ImageOrigin { get; set; }
}

[JsonSerializable(typeof(StoredConfig))]
[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    WriteIndented = true)]
internal partial class ConfigJsonContext : JsonSerializerContext { }
