using System.Collections.ObjectModel;
using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using NovaErp.Models;

namespace NovaErp.ViewModels;

public partial class DispatchViewModel : ViewModelBase, IRefreshable
{
    private readonly MainViewModel _root;

    public ObservableCollection<DispatchOrder> Dispatches { get; } = new();

    [ObservableProperty]
    private DispatchOrder? _selected;

    [ObservableProperty]
    private string _otp = "";

    [ObservableProperty]
    private string _statusMessage = "";

    public DispatchViewModel(MainViewModel root)
    {
        _root = root;
    }

    public async Task RefreshAsync()
    {
        try
        {
            Dispatches.Clear();
            if (_root.Api.IsAuthenticated)
            {
                var list = await _root.Api.GetDispatchesAsync();
                foreach (var d in list) Dispatches.Add(d);
            }
            Selected = Dispatches.Count > 0 ? Dispatches[0] : null;
            StatusMessage = $"{Dispatches.Count} active dispatches";
        }
        catch (System.Exception e)
        {
            StatusMessage = "Offline · " + e.Message;
        }
    }

    [RelayCommand]
    public void Pick(DispatchOrder d) => Selected = d;

    [RelayCommand]
    public Task ConfirmDeliveryAsync()
    {
        if (Selected is null) return Task.CompletedTask;
        if (Otp.Length < 4)
        {
            StatusMessage = "OTP required (4+ digits)";
            return Task.CompletedTask;
        }
        var idx = Dispatches.IndexOf(Selected);
        if (idx >= 0)
        {
            Dispatches[idx] = Selected with { Status = "delivered" };
            Selected = Dispatches[idx];
        }
        StatusMessage = $"Delivery confirmed · {Selected!.DispatchNo}";
        Otp = "";
        return Task.CompletedTask;
    }
}
