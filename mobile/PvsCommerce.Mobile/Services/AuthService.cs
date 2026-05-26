using System;
using System.IO;
using System.Text.Json;
using CommunityToolkit.Mvvm.ComponentModel;
using PvsCommerce.Mobile.Models;

namespace PvsCommerce.Mobile.Services;

public sealed class AuthService : ObservableObject
{
    private const string FileName = "pv_auth_v1.json";
    private readonly string _path;

    private AuthUser? _user;
    public AuthUser? User
    {
        get => _user;
        private set
        {
            SetProperty(ref _user, value);
            OnPropertyChanged(nameof(IsAuthed));
        }
    }

    public bool IsAuthed => _user is not null;

    private static string GetDataDir()
    {
        var d = Environment.GetFolderPath(
            Environment.SpecialFolder.LocalApplicationData,
            Environment.SpecialFolderOption.Create);
        if (string.IsNullOrEmpty(d)) d = Path.Combine(Path.GetTempPath(), "PvsCommerce");
        return Path.Combine(d, "PvsCommerce");
    }

    public AuthService()
    {
        _path = Path.Combine(GetDataDir(), FileName);
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        Load();
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_path)) return;
            var json = File.ReadAllText(_path);
            _user = JsonSerializer.Deserialize(json, AppJsonContext.Default.AuthUser);
        }
        catch { }
    }

    public void SignIn(AuthUser user)
    {
        User = new AuthUser
        {
            Name  = user.Name.Trim(),
            Email = user.Email.Trim().ToLowerInvariant(),
            Phone = user.Phone.Trim(),
        };
        try
        {
            File.WriteAllText(_path,
                JsonSerializer.Serialize(User, AppJsonContext.Default.AuthUser));
        }
        catch { }
    }

    public void SignOut()
    {
        User = null;
        try { File.Delete(_path); } catch { }
    }
}
