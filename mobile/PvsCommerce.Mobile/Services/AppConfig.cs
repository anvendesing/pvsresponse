using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace PvsCommerce.Mobile.Services;

// Per-platform configuration with runtime override.
//
// Android default: production VPS so the APK works out of the box.
//   nginx on the VPS proxies /v1/* to the backend, so the phone never
//   needs to reach port 4000 directly — just http://217.216.78.119/v1.
//
// Desktop default: localhost for the developer inner loop.
//
// The override persists in {LocalAppData}/PvsCommerce/api.json so users
// can switch between VPS and a local backend from the in-app Settings screen.
public sealed class AppConfig
{
    private const string FileName = "api.json";

    // Production VPS — shop nginx on :8080 proxies /v1/* and /uploads/* to the backend.
    public const string ProductionUrl = "http://217.216.78.119:8080/v1";
    public const string ProductionOrigin = "http://217.216.78.119:8080";

    public string ApiBaseUrl { get; private set; } =
#if ANDROID
        ProductionUrl;
#else
        "http://localhost:4000/v1";
#endif

    public string ImageOrigin { get; private set; } =
#if ANDROID
        ProductionOrigin;
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
