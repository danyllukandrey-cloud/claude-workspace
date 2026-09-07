// Component-тести (T28) -- усі 5 станів screens.md SCR-05 (default,
// ongoing-toggle, prefilled, validation, error), кожен за своїм тригером, не
// лише монтуванням. `onSubmit` підмінено vi.fn() -- реальної мережі
// не потрібно (ISS-45).
//
// jest-dom не підключено в цьому репозиторії (перевірено по інших *.test.tsx
// в shared/ui) -- перевірки йдуть напряму по DOM-властивостях, як і там.

import { render, screen, fireEvent } from '@testing-library/react';
import { MetricBlockForm } from './MetricBlockForm';

describe('MetricBlockForm (SCR-05)', () => {
  // default: порожня форма
  it('renders an empty form by default', () => {
    render(<MetricBlockForm onSubmit={vi.fn()} />);

    expect((screen.getByLabelText('Що рахуємо:') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Одиниця:') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Ціль:') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Постійний процес (без дати)') as HTMLInputElement).checked).toBe(
      false
    );
    expect(screen.queryByLabelText('До:')).not.toBeNull();
  });

  // ongoing-toggle (AC-05): вмикання "Постійний процес" ховає поле дати --
  // той самий тест закриває й окремий пункт DoD "перемикач ховає поле дати".
  it('hides the target-date field once "Постійний процес" is toggled on', () => {
    render(<MetricBlockForm onSubmit={vi.fn()} />);

    expect(screen.queryByLabelText('До:')).not.toBeNull();

    fireEvent.click(screen.getByLabelText('Постійний процес (без дати)'));

    expect((screen.getByLabelText('Постійний процес (без дати)') as HTMLInputElement).checked).toBe(
      true
    );
    expect(screen.queryByLabelText('До:')).toBeNull();
  });

  // prefilled (AC-07): значення прийшли готовими з підказки агента --
  // форма лише відображає їх, нічого сама не узгоджує.
  it('renders values pre-filled from an agent hint', () => {
    render(
      <MetricBlockForm
        onSubmit={vi.fn()}
        initialValues={{ label: 'тренування', unit: 'раз', targetCount: 12 }}
      />
    );

    expect((screen.getByLabelText('Що рахуємо:') as HTMLInputElement).value).toBe('тренування');
    expect((screen.getByLabelText('Одиниця:') as HTMLInputElement).value).toBe('раз');
    expect((screen.getByLabelText('Ціль:') as HTMLInputElement).value).toBe('12');
  });

  // validation: обов'язкові поля (label/unit) порожні -- inline-помилка під
  // полем, onSubmit не викликається.
  it('shows inline validation errors and never calls onSubmit when label/unit are empty', () => {
    const onSubmit = vi.fn();
    render(<MetricBlockForm onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    expect(screen.getAllByRole('alert')).toHaveLength(2);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // error: мережева помилка -- Banner.
  it('shows an error Banner when onSubmit rejects', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Мережева помилка'));
    render(
      <MetricBlockForm onSubmit={onSubmit} initialValues={{ label: 'тренування', unit: 'раз' }} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Зберегти' }));

    const banner = await screen.findByText('Мережева помилка');
    expect(banner.getAttribute('data-variant')).toBe('error');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  // D-111 (docs/DECISIONS.md): порядок полів -- живе тестування показало, що
  // "постійний процес" стосується того, ЩО рахуємо, тож іде одразу за ним.
  it('D-111: renders fields in order — що рахуємо -> постійний процес -> одиниця -> ціль/дата', () => {
    const { container } = render(<MetricBlockForm onSubmit={vi.fn()} />);
    const text = container.textContent ?? '';

    const idxLabel = text.indexOf('Що рахуємо:');
    const idxOngoing = text.indexOf('Постійний процес');
    const idxUnit = text.indexOf('Одиниця:');
    const idxTarget = text.indexOf('Ціль:');

    expect(idxLabel).toBeGreaterThan(-1);
    expect(idxLabel).toBeLessThan(idxOngoing);
    expect(idxOngoing).toBeLessThan(idxUnit);
    expect(idxUnit).toBeLessThan(idxTarget);
  });

  // D-112 (docs/DECISIONS.md): "Що рахуємо"/"Одиниця" обовʼязкові, "Ціль" -- ні.
  it('D-112: поля мають хмаринки-підказки з правильною позначкою обовʼязковості', () => {
    render(<MetricBlockForm onSubmit={vi.fn()} />);

    fireEvent.focus(screen.getByLabelText('Що рахуємо:'));
    expect(screen.getByRole('tooltip').textContent).toContain('Обовʼязково');

    fireEvent.blur(screen.getByLabelText('Що рахуємо:'));
    fireEvent.focus(screen.getByLabelText('Ціль:'));
    expect(screen.getByRole('tooltip').textContent).toContain('Необовʼязково');
  });
});
