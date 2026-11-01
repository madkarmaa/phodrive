import type { Command } from '@commander-js/extra-typings';
import { Ok, type AsyncResult } from 'results-ts';
import { readConfig, updateConfig } from '../config';
import type { CliContext, CliError, Runner } from '../context';
import { printJson, printTable, status } from '../output';
import {
    parseSettingKey,
    resetSetting,
    saveSetting,
    settingValue,
    settingValues
} from '../settings';

function showSettings(context: CliContext, json = false): AsyncResult<void, CliError> {
    return readConfig(context.configPath).map((config) => {
        const values = settingValues(config, context.environment);

        if (json) {
            printJson(
                context,
                values.map(({ key, value, source }) => ({ key, value, source }))
            );

            return;
        }

        printTable(
            context,
            ['Setting', 'Value', 'Source', 'Description', 'Allowed'],
            values.map(({ key, value, source, description, allowed }) => [
                key,
                String(value),
                source,
                description,
                allowed
            ])
        );
    });
}

function setSetting(
    context: CliContext,
    rawKey: string,
    value: string
): AsyncResult<void, CliError> {
    return parseSettingKey(rawKey).andThenAsync((key) =>
        updateConfig(context.configPath, (config) => saveSetting(config, key, value)).map(
            (config) => {
                const saved = settingValue(config, context.environment, key);

                status(context).success(`Set ${key} to ${saved.value}`);
            }
        )
    );
}

function clearSetting(context: CliContext, rawKey: string): AsyncResult<void, CliError> {
    return parseSettingKey(rawKey).andThenAsync((key) =>
        updateConfig(context.configPath, (config) => Ok(resetSetting(config, key))).map(
            (config) => {
                const restored = settingValue(config, context.environment, key);

                status(context).success(`Reset ${key} to the default, ${restored.value}`);
            }
        )
    );
}

export function registerSettingCommands(program: Command, context: CliContext, run: Runner) {
    const setting = program.command('setting').description('Show and change settings');

    setting
        .command('show')
        .description('Show every setting and where its value comes from')
        .option('--json', 'print JSON')
        .action((options) => run(() => showSettings(context, options.json)));

    setting
        .command('set')
        .description('Save a setting')
        .argument('<key>', 'sort or workers')
        .argument('<value>', 'new value')
        .action((key, value) => run(() => setSetting(context, key, value)));

    setting
        .command('reset')
        .description('Restore a setting to its default')
        .argument('<key>', 'sort or workers')
        .action((key) => run(() => clearSetting(context, key)));
}
