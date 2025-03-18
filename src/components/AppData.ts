import { dayjs, formatNumber } from "../utils/utils";
import { FormErrors, IAppState, ILot, IOrder, IOrderForm, LotStatus } from "../types";
import { Model } from "./base/Model";
import _ from "lodash";
import {IEvents} from "./base/events"

/**
 * Модель лота аукциона
 */
export class LotItem extends Model<ILot> {
    id: string;
    title: string;
    image: string;
    description: string;
    about: string;
    minPrice: number;
    price: number;
    status: LotStatus;
    datetime: string;
    history: number[];

    private myLastBid: number = 0;

    constructor(data: ILot, events: IEvents) {
        super(data, events);
        Object.assign(this, data);
    }

    /**
     * Сбросить последнюю ставку пользователя
     */
    clearBid() {
        this.myLastBid = 0;
    }

    /**
     * Сделать ставку на лот
     * @param price - новая ставка
     */
    placeBid(price: number): void {
        this.price = price;
        this.history = [...this.history, price];
        this.myLastBid = price;

        if (price > this.minPrice * 10) {
            this.status = "closed";
        }

        this.emitChanges("auction:changed", { id: this.id, price });
    }

    /**
     * Проверяет, является ли последняя ставка пользователя текущей
     */
    get isMyBid(): boolean {
        return this.myLastBid === this.price;
    }

    /**
     * Проверяет, делал ли пользователь ставки на этот лот
     */
    get isParticipate(): boolean {
        return this.myLastBid !== 0;
    }

    /**
     * Возвращает текстовое описание статуса лота
     */
    get statusLabel(): string {
        switch (this.status) {
            case "active":
                return `Открыто до ${new Date(this.datetime).toLocaleString()}`;
            case "closed":
                return `Закрыто ${new Date(this.datetime).toLocaleString()}`;
            case "wait":
                return `Откроется ${new Date(this.datetime).toLocaleString()}`;
            default:
                return this.status;
        }
    }

    /**
     * Возвращает текстовое описание времени аукциона
     */
    get timeStatus(): string {
        if (this.status === "closed") return "Аукцион завершён";

        const timeLeft = new Date(this.datetime).getTime() - Date.now();
        const seconds = Math.floor(timeLeft / 1000) % 60;
        const minutes = Math.floor(timeLeft / 1000 / 60) % 60;
        const hours = Math.floor(timeLeft / 1000 / 60 / 60);

        return `${hours}ч ${minutes}м ${seconds}с`;
    }

    /**
     * Возвращает текстовое описание текущего состояния аукциона
     */
    get auctionStatus(): string {
        switch (this.status) {
            case "closed":
                return `Продано за ${this.price}₽`;
            case "wait":
                return "До начала аукциона";
            case "active":
                return "До закрытия лота";
            default:
                return "";
        }
    }

    /**
     * Рассчитывает сумму следующей ставки (на 10% больше текущей)
     */
    get nextBid(): number {
        return Math.floor(this.price * 1.1);
    }
}




/**
 * Модель данных приложения
 * Управляет состоянием аукциона и заказов.
 */
export class AppState extends Model<IAppState> {
    /** Список идентификаторов лотов, добавленных в корзину */
    basket: string[];
    
    /** Каталог всех лотов, представленных в аукционе */
    catalog: LotItem[];
    
    /** Флаг загрузки данных */
    loading: boolean;
    
    /** Данные текущего заказа */
    order: IOrder = {
        email: '',  // Email пользователя
        phone: '',  // Телефон пользователя
        items: []   // Список идентификаторов лотов в заказе
    };
    
    /** Идентификатор выбранного для предпросмотра лота */
    preview: string | null;
    
    /** Ошибки валидации формы заказа */
    formErrors: FormErrors = {};

    /**
     * Добавляет или удаляет лот из списка заказанных
     * @param id - идентификатор лота
     * @param isIncluded - true, если лот добавляется, false, если удаляется
     */
    toggleOrderedLot(id: string, isIncluded: boolean) {
        if (isIncluded) {
            this.order.items = _.uniq([...this.order.items, id]);
        } else {
            this.order.items = _.without(this.order.items, id);
        }
    }

    /**
     * Очищает корзину, сбрасывая ставки на лоты
     */
    clearBasket() {
        this.order.items.forEach(id => {
            this.toggleOrderedLot(id, false);
            this.catalog.find(it => it.id === id)?.clearBid();
        });
    }

    /**
     * Рассчитывает общую стоимость лотов в заказе
     * @returns сумма всех выбранных лотов
     */
    getTotal() {
        return this.order.items.reduce((a, c) => a + (this.catalog.find(it => it.id === c)?.price || 0), 0);
    }

    /**
     * Устанавливает каталог лотов и уведомляет подписчиков об изменении
     * @param items - список лотов
     */
    setCatalog(items: ILot[]) {
        this.catalog = items.map(item => new LotItem(item, this.events));
        this.emitChanges('items:changed', { catalog: this.catalog });
    }

    /**
     * Устанавливает лот в режиме предпросмотра
     * @param item - объект лота
     */
    setPreview(item: LotItem) {
        this.preview = item.id;
        this.emitChanges('preview:changed', item);
    }

    /**
     * Получает список активных лотов, в которых пользователь участвует
     * @returns массив активных лотов
     */
    getActiveLots(): LotItem[] {
        return this.catalog.filter(item => item.status === 'active' && item.isParticipate);
    }

    /**
     * Получает список закрытых лотов, в которых пользователь делал ставки
     * @returns массив закрытых лотов
     */
    getClosedLots(): LotItem[] {
        return this.catalog.filter(item => item.status === 'closed' && item.isMyBid);
    }

    /**
     * Устанавливает значение в поле заказа и проверяет валидность формы
     * @param field - название поля
     * @param value - значение поля
     */
    setOrderField(field: keyof IOrderForm, value: string) {
        this.order[field] = value;

        if (this.validateOrder()) {
            this.events.emit('order:ready', this.order);
        }
    }

    /**
     * Проверяет валидность данных заказа
     * @returns true, если заказ заполнен корректно, иначе false
     */
    validateOrder() {
        const errors: typeof this.formErrors = {};
        
        if (!this.order.email) {
            errors.email = 'Необходимо указать почту';
        }
        if (!this.order.phone) {
            errors.phone = 'Необходимо указать номер телефона';
        }
        
        this.formErrors = errors;
        this.events.emit('errors:change', this.formErrors);
        
        return Object.keys(errors).length === 0;
    }
}