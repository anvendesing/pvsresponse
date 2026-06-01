using System;
using System.IO;

namespace NovaErp.Services;

public static class AppSettings
{
    public static string ApiBaseUrl => Environment.GetEnvironmentVariable("NOVA_API")
        ?? "http://localhost:4000";

    public static string DataDir
    {
        get
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "NovaErp");
            Directory.CreateDirectory(dir);
            return dir;
        }
    }

    public static string LocalDbPath => Path.Combine(DataDir, "novaerp.cache.db");
    public static string DeviceIdPath => Path.Combine(DataDir, "device.id");

    public static string DeviceId
    {
        get
        {
            if (File.Exists(DeviceIdPath)) return File.ReadAllText(DeviceIdPath).Trim();
            var id = "dev-" + Guid.NewGuid().ToString("N")[..12];
            File.WriteAllText(DeviceIdPath, id);
            return id;
        }
    }
}
