using System;
using System.Net.Http;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.Models;
using NovaErp.Services;

namespace NovaErp.ViewModels;

public partial class MainViewModel : ViewModelBase
{
    public ApiClient Api { get; }
    public LocalCache Cache { get; }
    public SyncService Sync { get; }

    [ObservableProperty]
    private ViewModelBase _currentView;

    [ObservableProperty]
    private bool _isAuthenticated;

    [ObservableProperty]
    private string _activeNav = "warehouse";

    [ObservableProperty]
    private string _syncStatus = "idle";

    [ObservableProperty]
    private int _outboxCount;

    [ObservableProperty]
    private string _userName = "—";

    [ObservableProperty]
    private string _userRole = "guest";

    public LoginViewModel Login { get; }
    public WarehouseStationViewModel Warehouse { get; }
    public ManufacturingStationViewModel Manufacturing { get; }
    public DispatchViewModel Dispatch { get; }
    public AttendanceViewModel Attendance { get; }

    public MainViewModel()
    {
        Api = new ApiClient(new HttpClient());
        Cache = new LocalCache();
        Sync = new SyncService(Api, Cache);
        Sync.StatusChanged += s => SyncStatus = s;
        Sync.OutboxChanged += n => OutboxCount = n;
        OutboxCount = Cache.OutboxCount();

        Login = new LoginViewModel(this);
        Warehouse = new WarehouseStationViewModel(this);
        Manufacturing = new ManufacturingStationViewModel(this);
        Dispatch = new DispatchViewModel(this);
        Attendance = new AttendanceViewModel(this);

        _currentView = Login;
    }

    public void OnLoggedIn(AppUser user)
    {
        IsAuthenticated = true;
        UserName = user.Name;
        UserRole = user.Role;
        Sync.Start();
        NavigateTo("warehouse");
    }

    [RelayCommand]
    public void Logout()
    {
        Sync.Stop();
        Api.SetToken(null, null);
        IsAuthenticated = false;
        CurrentView = Login;
    }

    [RelayCommand]
    public void NavigateTo(string key)
    {
        ActiveNav = key;
        CurrentView = key switch
        {
            "warehouse" => Warehouse,
            "manufacturing" => Manufacturing,
            "dispatch" => Dispatch,
            "attendance" => Attendance,
            _ => Warehouse,
        };
        if (CurrentView is IRefreshable r) _ = r.RefreshAsync();
    }

    [RelayCommand]
    public async Task SyncNowAsync()
    {
        try { await Sync.SyncOnceAsync(); }
        catch (Exception e) { SyncStatus = "error: " + e.Message; }
    }
}

public interface IRefreshable
{
    Task RefreshAsync();
}
