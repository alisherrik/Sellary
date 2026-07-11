export function OfflineFirstRunScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow dark:bg-gray-800">
        <div className="mb-3 text-4xl">📡</div>
        <h1 className="mb-2 text-xl font-bold dark:text-white">
          Для первой настройки нужен интернет
        </h1>
        <p className="text-sm text-gray-500">
          Подключитесь к сети и войдите, чтобы зарегистрировать кассу и задать PIN.
          После первой настройки касса работает офлайн.
        </p>
      </div>
    </div>
  );
}
