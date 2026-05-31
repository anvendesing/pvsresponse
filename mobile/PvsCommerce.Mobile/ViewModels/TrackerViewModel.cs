using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace PvsCommerce.Mobile.ViewModels;

// Live dispatch tracker shown after a successful order — vertical 5-step
// timeline with an "advance" button to demo state transitions.
public partial class TrackerViewModel : ViewModelBase
{
    [ObservableProperty] private bool _isOpen;
    [ObservableProperty] private string _invoiceLabel = "PV-2026-000000";
    [ObservableProperty] private int _activeStep = 2;     // 1..5

    public void Open(string invoiceNo)
    {
        InvoiceLabel = string.IsNullOrWhiteSpace(invoiceNo) ? "PV-2026-000000" : invoiceNo;
        ActiveStep = 2;
        IsOpen = true;
    }

    [RelayCommand] private void Close() => IsOpen = false;

    [RelayCommand]
    private void AdvanceStep()
    {
        if (ActiveStep < 5) ActiveStep++;
    }

    public bool Step1Done => ActiveStep > 1;
    public bool Step2Done => ActiveStep > 2;
    public bool Step3Done => ActiveStep > 3;
    public bool Step4Done => ActiveStep > 4;
    public bool Step5Done => ActiveStep > 5;
    public bool Step1Active => ActiveStep == 1;
    public bool Step2Active => ActiveStep == 2;
    public bool Step3Active => ActiveStep == 3;
    public bool Step4Active => ActiveStep == 4;
    public bool Step5Active => ActiveStep == 5;

    partial void OnActiveStepChanged(int value)
    {
        OnPropertyChanged(nameof(Step1Done));
        OnPropertyChanged(nameof(Step2Done));
        OnPropertyChanged(nameof(Step3Done));
        OnPropertyChanged(nameof(Step4Done));
        OnPropertyChanged(nameof(Step5Done));
        OnPropertyChanged(nameof(Step1Active));
        OnPropertyChanged(nameof(Step2Active));
        OnPropertyChanged(nameof(Step3Active));
        OnPropertyChanged(nameof(Step4Active));
        OnPropertyChanged(nameof(Step5Active));
    }
}
