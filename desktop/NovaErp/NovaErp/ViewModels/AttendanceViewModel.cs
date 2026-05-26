using System.Threading.Tasks;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace NovaErp.ViewModels;

public partial class AttendanceViewModel : ViewModelBase, IRefreshable
{
    private readonly MainViewModel _root;

    [ObservableProperty]
    private string _empNo = "";

    [ObservableProperty]
    private string _direction = "in"; // in | out | break

    [ObservableProperty]
    private string _statusMessage = "Scan badge or type employee number.";

    public AttendanceViewModel(MainViewModel root)
    {
        _root = root;
    }

    public Task RefreshAsync() => Task.CompletedTask;

    [RelayCommand]
    public void SetDirection(string d) => Direction = d;

    [RelayCommand]
    public Task PunchAsync()
    {
        if (string.IsNullOrWhiteSpace(EmpNo))
        {
            StatusMessage = "Enter or scan employee number.";
            return Task.CompletedTask;
        }
        // Queue for sync
        var payload = new System.Collections.Generic.Dictionary<string, object?>
        {
            ["workerId"] = EmpNo,
            ["date"] = System.DateTime.UtcNow.ToString("o"),
            ["shift"] = "A",
            ["inAt"] = Direction == "in" ? System.DateTime.UtcNow.ToString("o") : null,
            ["outAt"] = Direction == "out" ? System.DateTime.UtcNow.ToString("o") : null,
        };
        _root.Cache.EnqueueMutation(new Models.SyncMutation(
            "Attendance",
            "client-" + System.Guid.NewGuid().ToString("N")[..16],
            "insert",
            null,
            payload,
            System.DateTime.UtcNow.ToString("o")));

        StatusMessage = $"Punched {Direction.ToUpper()} · {EmpNo} · queued for sync";
        EmpNo = "";
        return Task.CompletedTask;
    }
}
