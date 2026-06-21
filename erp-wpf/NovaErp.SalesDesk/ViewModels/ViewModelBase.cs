using CommunityToolkit.Mvvm.ComponentModel;

namespace NovaErp.SalesDesk.ViewModels;

public abstract partial class ViewModelBase : ObservableObject
{
    [ObservableProperty] private bool _isBusy;
    [ObservableProperty] private string? _statusMessage;
    [ObservableProperty] private string? _errorMessage;

    protected void ClearMessages()
    {
        ErrorMessage = null;
        StatusMessage = null;
    }

    protected async Task RunAsync(Func<Task> action, string? busyMessage = null)
    {
        if (IsBusy) return;
        try
        {
            IsBusy = true;
            ErrorMessage = null;
            StatusMessage = busyMessage;
            await action();
        }
        catch (Exception ex)
        {
            ErrorMessage = ex.Message;
        }
        finally
        {
            IsBusy = false;
            StatusMessage = null;
        }
    }
}
