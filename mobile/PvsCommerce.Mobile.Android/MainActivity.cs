using Android.App;
using Android.Content.PM;
using Avalonia;
using Avalonia.Android;
using PvsCommerce.Mobile;

namespace PvsCommerce.Mobile.Android;

// Avalonia 11.x: single entry point. AvaloniaMainActivity handles the full
// Android lifecycle; CustomizeAppBuilder is the hook for AppBuilder config.
[Activity(
    Label = "Prakruthivanam",
    Theme = "@style/MyTheme.NoActionBar",
    Icon = "@drawable/icon",
    MainLauncher = true,
    ConfigurationChanges = ConfigChanges.Orientation | ConfigChanges.ScreenSize | ConfigChanges.UiMode)]
public class MainActivity : AvaloniaMainActivity
{
    protected override AppBuilder CustomizeAppBuilder(AppBuilder builder)
        => base.CustomizeAppBuilder(builder)
            .WithInterFont();
}
