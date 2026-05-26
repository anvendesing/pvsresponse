using System;
using System.Collections.Generic;
using CommunityToolkit.Mvvm.ComponentModel;

namespace PvsCommerce.Mobile.Services;

public interface INavigationService
{
    object? CurrentPage { get; }
    bool CanGoBack { get; }
    void NavigateTo(object pageViewModel);
    void GoBack();
}

// Stack-based navigator. ViewModels call INavigationService.NavigateTo(vm).
// MainViewModel observes CurrentPage; MainView hosts a ContentControl whose
// Content = CurrentPage and DataTemplates resolve the correct view per-type.
public sealed class NavigationService : ObservableObject, INavigationService
{
    private readonly Stack<object> _stack = new();

    private object? _currentPage;
    public object? CurrentPage
    {
        get => _currentPage;
        private set => SetProperty(ref _currentPage, value);
    }

    public bool CanGoBack => _stack.Count > 0;

    public void NavigateTo(object pageViewModel)
    {
        if (_currentPage is not null)
            _stack.Push(_currentPage);
        CurrentPage = pageViewModel;
        OnPropertyChanged(nameof(CanGoBack));
    }

    public void GoBack()
    {
        if (_stack.Count == 0) return;
        CurrentPage = _stack.Pop();
        OnPropertyChanged(nameof(CanGoBack));
    }

    // Replace the whole stack — used when deep-linking or tapping bottom-nav.
    public void NavigateRoot(object pageViewModel)
    {
        _stack.Clear();
        CurrentPage = pageViewModel;
        OnPropertyChanged(nameof(CanGoBack));
    }
}
