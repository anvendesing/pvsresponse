using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using PvsCommerce.Mobile.Services;

namespace PvsCommerce.Mobile.ViewModels;

// Lets the user point the app at any backend host without rebuilding the APK.
// The URL is persisted to LocalAppData/PvsCommerce/api.json by AppConfig.
public partial class SettingsViewModel : ViewModelBase
{
    private readonly AppConfig _config;
    private readonly CatalogService _catalog;

    public SettingsViewModel(AppConfig config, CatalogService catalog)
    {
        _config = config;
        _catalog = catalog;
        ApiBaseUrl = _config.ApiBaseUrl;
    }

    [ObservableProperty] private string _apiBaseUrl = "";
    [ObservableProperty] private string? _statusMessage;
    [ObservableProperty] private bool _isBusy;

    public string ImageOrigin => _config.ImageOrigin;

    [RelayCommand]
    private async Task SaveAsync()
    {
        IsBusy = true;
        StatusMessage = null;
        try
        {
            var url = (ApiBaseUrl ?? "").Trim();
            if (string.IsNullOrEmpty(url))
            {
                StatusMessage = "Enter a URL like http://192.168.1.10:4000/v1";
                return;
            }
            _config.SaveOverride(url);
            OnPropertyChanged(nameof(ImageOrigin));
            // Force the catalog cache to drop so next Home load hits new URL.
            _catalog.Invalidate();
            try
            {
                await _catalog.RefreshAsync();
                StatusMessage = $"Connected. Loaded {_catalog.Products.Count} products.";
            }
            catch (System.Exception ex)
            {
                StatusMessage = $"Saved, but test fetch failed: {ex.Message}";
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private void ResetToDefault()
    {
#if ANDROID
        ApiBaseUrl = "http://10.0.2.2:4000/v1";
#else
        ApiBaseUrl = "http://localhost:4000/v1";
#endif
    }
}
